/**
 * Plan-limit and rate-limit policy checks. Run with:
 *
 *   npm run verify:plans
 *
 * These are pure decisions, so they are tested with a stub client rather than
 * the live database: the ceiling arithmetic and the "which plan is more
 * restrictive" fallback are exactly the things that regress silently, and a
 * test that needs Postgres is a test that stops running.
 *
 * The SQL behind `consumeRateLimit` and the uniqueness of the Stripe event
 * ledger are *not* covered here — those need a real database and are verified
 * by `scripts/verify-live-db.ts`.
 */

import {
  planLimit,
  ceilingFor,
  assertWithinPlan,
  type LimitedModel,
} from "../lib/planLimits";
import { RATE_LIMITS } from "../lib/rateLimit";
import { HttpError } from "../lib/errors";

let failures = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  [ok]   ${name}`);
  } else {
    failures++;
    console.error(`  [FAIL] ${name}`);
  }
}

/** A delegate stub that answers count() from a fixed number. */
function stubDb(count: number, model: LimitedModel) {
  return {
    [model === "booking" ? "shippingBooking" : model === "vessel" ? "shippingVessel" : model]: {
      count: async (args: { where: { userId: string } }) => {
        if (!args?.where?.userId) throw new Error("count() was not scoped by userId");
        return count;
      },
    },
  } as never;
}

async function attempt(
  count: number,
  model: LimitedModel,
  plan: string,
  additional = 1,
): Promise<{ status?: number; code?: string; message?: string }> {
  try {
    await assertWithinPlan(stubDb(count, model), { id: "u1", subscriptionPlan: plan }, model, additional);
    return {};
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, code: e.code, message: e.message };
    throw e;
  }
}

console.log("Plan resolution");
check("trial is unlimited", planLimit("trial").maxTrucks === null);
check("lite is 5 trucks", planLimit("lite").maxTrucks === 5);
check("pro is 20 trucks", planLimit("pro").maxTrucks === 20);
check("enterprise is unlimited", planLimit("enterprise").maxTrucks === null);
check(
  "unknown plan falls back to the most restrictive, never unlimited",
  planLimit("mystery-tier").maxTrucks === 5,
);
check("unknown plan is labelled as the fallback", planLimit("mystery-tier").label === "Lite");

console.log("Ceilings");
check("trucks are metered 1:1", ceilingFor("truck", 5) === 5);
check("drivers are metered 1:1", ceilingFor("driver", 5) === 5);
check("vessels are metered 1:1", ceilingFor("vessel", 5) === 5);
check("loads scale with the fleet", ceilingFor("load", 5) === 250);
check("bookings scale with the fleet", ceilingFor("booking", 5) === 250);
check("pro fleet ceiling", ceilingFor("truck", 20) === 20);

// Wrapped because this package is CJS and top-level await is unavailable.
async function main() {
  console.log("Enforcement");
  check("trial may add a truck beyond any paid ceiling", (await attempt(99, "truck", "trial")).status === undefined);
  check("enterprise may add beyond any ceiling", (await attempt(999, "truck", "enterprise")).status === undefined);
  check("lite with 4 of 5 trucks is allowed", (await attempt(4, "truck", "lite")).status === undefined);
  check("lite at exactly 5 of 5 is allowed", (await attempt(5, "truck", "lite", 0)).status === undefined);

  const over = await attempt(5, "truck", "lite");
  check("lite adding a 6th truck is refused", over.status === 402);
  check("refusal code is plan_limit_reached", over.code === "plan_limit_reached");
  check("refusal names the plan and the current count", /Lite/.test(over.message ?? "") && /You have 5/.test(over.message ?? ""));
  check("refusal tells the user what to do", /Upgrade/.test(over.message ?? ""));
  check("a bulk add of 3 is judged on the total", (await attempt(3, "truck", "lite", 3)).status === 402);
  check("a bulk add that fits is allowed", (await attempt(2, "truck", "lite", 3)).status === undefined);
  check("load ceiling is 250 on lite, so 250 is allowed", (await attempt(250, "load", "lite", 0)).status === undefined);
  check("load 251 is refused", (await attempt(250, "load", "lite")).status === 402);
  check("driver over the fleet is refused", (await attempt(5, "driver", "lite")).status === 402);
  check("booking over 50x the fleet is refused", (await attempt(250, "booking", "lite")).status === 402);
  check("vessel over the fleet is refused", (await attempt(5, "vessel", "lite")).status === 402);

  console.log("Delegates resolve to the real Prisma model names");
  {
    // A wrong delegate name is a silent "cannot read property of undefined" at
    // runtime on a paid customer's create request, so assert the mapping.
    const ok = await attempt(0, "booking", "trial");
    check("booking maps to shippingBooking", ok.status === undefined);
    const okVessel = await attempt(0, "vessel", "trial");
    check("vessel maps to shippingVessel", okVessel.status === undefined);
  }
}

main()
  .catch((e) => {
    failures++;
    console.error(`  [FAIL] enforcement section threw: ${e}`);
  })
  .finally(() => {
    console.log("Rate limit policies");
    check("AI parse is the tightest metered call", RATE_LIMITS.aiParse.limit <= RATE_LIMITS.parseRateConfirm.limit);
    check("every window is at least a minute", Object.values(RATE_LIMITS).every((p) => p.windowSeconds >= 60));
    check("every limit is a positive integer", Object.values(RATE_LIMITS).every((p) => Number.isInteger(p.limit) && p.limit > 0));
    check("signup is limited per hour for anonymous traffic", RATE_LIMITS.signup.windowSeconds === 3600);
    check("no policy named for a route that does not exist", !("signin" in RATE_LIMITS));

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  });

console.log("Rate limit policies");
check("AI parse is the tightest metered call", RATE_LIMITS.aiParse.limit <= RATE_LIMITS.parseRateConfirm.limit);
check("every window is at least a minute", Object.values(RATE_LIMITS).every((p) => p.windowSeconds >= 60));
check("every limit is a positive integer", Object.values(RATE_LIMITS).every((p) => Number.isInteger(p.limit) && p.limit > 0));
check("signup is limited per hour for anonymous traffic", RATE_LIMITS.signup.windowSeconds === 3600);
check("no policy named for a route that does not exist", !("signin" in RATE_LIMITS));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
