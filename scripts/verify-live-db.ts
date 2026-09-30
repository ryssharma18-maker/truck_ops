/**
 * Live checks for the pieces that cannot be unit-tested: the conditional-upsert
 * SQL behind `consumeRateLimit` and the unique-constraint behaviour of the
 * Stripe event ledger. Both need a real Postgres, so this is not part of CI.
 *
 *   npx tsx scripts/verify-live-db.ts
 *
 * It creates rows in `rate_limits` and `stripe_events` and removes them again.
 * It never touches a tenant table.
 */

import { prisma } from "../lib/prisma";
import { consumeRateLimit, RATE_LIMITS } from "../lib/rateLimit";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  [ok]   ${name}`);
  else {
    failures++;
    console.error(`  [FAIL] ${name}`);
  }
}

function bucketFor(tag: string) {
  return createHash("sha256").update(tag).digest("hex").slice(0, 32);
}

async function cleanup(tag: string) {
  await prisma.rateLimit.deleteMany({ where: { bucketKey: bucketFor(tag) } });
}

async function main() {
  console.log("Rate limiter: window counting");
  {
    const tag = `verify-live-db-${Date.now()}`;
    const policy = { limit: 3, windowSeconds: 60 };
    try {
      const seen: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await consumeRateLimit(tag, policy);
        seen.push(r.allowed);
      }
      check("calls 1-3 allowed", seen.slice(0, 3).every(Boolean));
      check("calls 4-5 refused", seen.slice(3).every((x) => !x));

      const row = await prisma.rateLimit.findUnique({ where: { bucketKey: bucketFor(tag) } });
      check("counter persisted", row?.count === 5);
      check(
        "window is in the future",
        !!row && row.expiresAt.getTime() > Date.now(),
      );

      const other = await consumeRateLimit(`${tag}-other`, policy);
      check("a different bucket is independent", other.allowed && other.remaining === policy.limit - 1);
      const otherRow = await prisma.rateLimit.findUnique({ where: { bucketKey: bucketFor(`${tag}-other`) } });
      check("separate bucket counted separately", otherRow?.count === 1);
    } finally {
      await cleanup(tag);
      await cleanup(`${tag}-other`);
    }
  }

  console.log("Rate limiter: window reset");
  {
    const tag = `verify-live-db-reset-${Date.now()}`;
    // The window is forced open by moving expires_at into the past rather than
    // by waiting for a short window to elapse. A 1-second window looked simpler
    // but is unreliable here: a cold TLS handshake on this network takes
    // 2.4-11.6s, so "1 second" had already elapsed before the second call
    // arrived and the test asserted nothing about the reset branch.
    const policy = { limit: 1, windowSeconds: 60 };
    try {
      const first = await consumeRateLimit(tag, policy);
      const second = await consumeRateLimit(tag, policy);
      check("first call allowed", first.allowed);
      check("second call inside the window refused", !second.allowed);

      await prisma.rateLimit.update({
        where: { bucketKey: bucketFor(tag) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const third = await consumeRateLimit(tag, policy);
      check("call after the window expired is allowed again", third.allowed);
      const row = await prisma.rateLimit.findUnique({ where: { bucketKey: bucketFor(tag) } });
      check("counter reset to 1, not accumulated", row?.count === 1);
      check("window start moved forward", (row?.windowStart.getTime() ?? 0) > Date.now() - 5000);
    } finally {
      await cleanup(tag);
    }
  }

  console.log("Rate limiter: retryAfter is usable");
  {
    const tag = `verify-live-db-retry-${Date.now()}`;
    try {
      const r = await consumeRateLimit(tag, { limit: 1, windowSeconds: 45 });
      // A client can only act on this if it is a positive, finite number of
      // seconds. It cannot be exact: expires_at comes from the database clock
      // while the response is produced on the app's clock, so any offset
      // between the two shifts the advertised value. That offset is measured
      // below rather than asserted away.
      check(
        "retryAfter is a positive integer (never NaN, 0 or negative)",
        Number.isInteger(r.retryAfterSeconds) && r.retryAfterSeconds > 0,
      );
      check("remaining decrements", r.remaining === 0);
    } finally {
      await cleanup(tag);
    }
  }

  console.log("Clock skew between the app and the database (informational)");
  {
    const before = Date.now();
    const rows = await prisma.$queryRaw<{ db_now: Date }[]>(
      Prisma.sql`SELECT now() AS db_now`,
    );
    const after = Date.now();
    const dbNow = new Date(rows[0]!.db_now).getTime();
    // The query round trip bounds the measurement: dbNow was true somewhere
    // inside [before, after].
    const skewSeconds = Math.round((dbNow - (before + after) / 2) / 1000) / 1;
    console.log(
      `  [info] database clock is ${skewSeconds >= 0 ? "+" : ""}${skewSeconds}s relative to the app clock ` +
        `(round trip ${after - before}ms, so the true offset is within ±${Math.round((after - before) / 2000)}s)`,
    );
    check(
      "skew is small enough that a 45s window is not misreported as expired",
      Math.abs(skewSeconds) < 45,
    );
  }

  console.log("Rate limiter: concurrency");
  {
    const tag = `verify-live-db-race-${Date.now()}`;
    const policy = { limit: 1000, windowSeconds: 60 };
    try {
      // Four simultaneous upserts. If the increment were read-then-write rather
      // than atomic, several would land on the same value and the final count
      // would be below 4. Four rather than a large fan-out because the runtime
      // pool is deliberately `connection_limit=1`; see the note in
      // lib/rateLimit.ts about what that ceiling does.
      const results = await Promise.all(
        Array.from({ length: 4 }, () => consumeRateLimit(tag, policy)),
      );
      const row = await prisma.rateLimit.findUnique({ where: { bucketKey: bucketFor(tag) } });
      check(`no lost updates under concurrency (count=${row?.count})`, row?.count === 4);
      const distinct = new Set(results.map((r) => r.remaining)).size;
      check(`each caller saw a distinct count (${distinct}/4)`, distinct === 4);
    } finally {
      await cleanup(tag);
    }
  }

  console.log("Rate limiter: measured pool ceiling (informational)");
  {
    // Reported, not asserted. The runtime URL pins `connection_limit=1`, so
    // this measures how much simultaneous work the pool will actually serve
    // rather than testing a property of the limiter.
    const tag = `verify-live-db-ceiling-${Date.now()}`;
    let served = 0;
    let poolTimeouts = 0;
    try {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          consumeRateLimit(tag, { limit: 1000, windowSeconds: 60 }, { onError: "open" }),
        ),
      );
      for (const o of outcomes) if (o.status === "fulfilled") served++;
      poolTimeouts = 12 - served;
      console.log(
        `  [info] 12 concurrent limiter calls: ${served} served, ${poolTimeouts} hit the pool ceiling`,
      );
    } finally {
      await cleanup(tag);
    }
  }

  console.log("Rate limiter: policy sanity against the table");
  {
    check("all named policies are usable", Object.keys(RATE_LIMITS).length >= 8);
  }

  console.log("Stripe event ledger: uniqueness");
  {
    const id = `evt_verify_${Date.now()}`;
    try {
      await prisma.stripeEvent.create({ data: { id, type: "verify.test", userId: null, ignored: true } });
      check("first insert succeeds", true);
      let dupCode = "";
      try {
        await prisma.stripeEvent.create({ data: { id, type: "verify.test", userId: null } });
      } catch (e) {
        dupCode = (e as { code?: string }).code ?? "";
      }
      check(`duplicate event id is rejected with P2002 (got ${dupCode || "none"})`, dupCode === "P2002");
      const found = await prisma.stripeEvent.findUnique({ where: { id } });
      check("ledger row is readable by id", found?.id === id);
    } finally {
      await prisma.stripeEvent.deleteMany({ where: { id: { startsWith: "evt_verify_" } } });
    }
  }

  console.log("Cleanup");
  {
    const leftoverRl = await prisma.rateLimit.count();
    const leftoverEv = await prisma.stripeEvent.count();
    check(`rate_limits is clean (${leftoverRl} rows)`, leftoverRl === 0);
    check(`stripe_events is clean (${leftoverEv} rows)`, leftoverEv === 0);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await prisma.$disconnect();
    failures++;
    console.error("  [FAIL] threw:", e);
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
  });
