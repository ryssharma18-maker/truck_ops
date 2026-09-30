import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/errors";

/**
 * Postgres-backed fixed-window rate limiting.
 *
 * Why not an in-process Map: serverless functions are short-lived and
 * horizontally scaled. A module-level Map is wiped on every cold start and is
 * not shared between instances, so it resets the moment you need it most and
 * cannot cap a spend. The only routes that strictly need this are the ones
 * that cost money per call (Gemini parsing, email sends) and the ones that
 * accept anonymous traffic.
 *
 * Why not Redis/Upstash: a new dependency, another service, another thing to
 * provision before the app works. A single conditional upsert against a table
 * already in the schema is atomic and adds no infrastructure.
 *
 * The trade-off is one extra round trip per limited request. That is cheaper
 * than a Gemini call and cheaper than an outbound email.
 */

/** Named policies, so a limit is never a bare number at a call site. */
export const RATE_LIMITS = {
  /** AI extraction. Each hit can cost real money at the model. */
  aiParse: { limit: 20, windowSeconds: 60 * 60 },
  /** Document uploads, per tenant. Storage write plus optional AI call. */
  documentUpload: { limit: 60, windowSeconds: 60 * 60 },
  shippingDocumentUpload: { limit: 60, windowSeconds: 60 * 60 },
  /** Outbound transactional email. Prevents mailing a broker 500 invoices. */
  invoiceSend: { limit: 30, windowSeconds: 60 * 60 },
  /** Creates a Stripe Checkout Session each time. */
  billingCheckout: { limit: 10, windowSeconds: 60 * 60 },
  /** Anonymous, keyed by IP. No CAPTCHA in front of this. */
  signup: { limit: 5, windowSeconds: 60 * 60 },
  /** Inline parse confirmations, the other end of the AI spend. */
  parseRateConfirm: { limit: 30, windowSeconds: 60 * 60 },
  /** Per-tenant row creation, which is what a paid plan is metered against. */
  createRow: { limit: 300, windowSeconds: 60 * 60 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets. */
  retryAfterSeconds: number;
}

/** Hash the bucket name so raw IPs are not stored and the key stays short. */
function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/**
 * Count one request against a bucket, and report whether it is over the limit.
 *
 * The upsert is a single statement so concurrent requests cannot both read
 * count=4 and both write 5. When the window has expired the row is reset in
 * place rather than deleted, so there is no window where two requests both
 * see "no row" and both start at 1.
 */
export async function consumeRateLimit(
  bucket: string,
  {
    limit,
    windowSeconds,
  }: { limit: number; windowSeconds: number },
  opts: { onError?: "open" | "closed" } = {},
): Promise<RateLimitResult> {
  const bucketKey = hashKey(bucket);
  const onError = opts.onError ?? "closed";

  try {
    const rows = await prisma.$queryRaw<
      { count: number; expires_at: Date }[]
    >(Prisma.sql`
      INSERT INTO rate_limits (bucket_key, count, window_start, expires_at)
      VALUES (${bucketKey}, 1, now(), now() + (${windowSeconds} * interval '1 second'))
      ON CONFLICT (bucket_key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.expires_at <= now() THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.expires_at <= now() THEN now()
          ELSE rate_limits.window_start
        END,
        expires_at = CASE
          WHEN rate_limits.expires_at <= now() THEN now() + (${windowSeconds} * interval '1 second')
          ELSE rate_limits.expires_at
        END
      RETURNING count, expires_at
    `);

    const row = rows[0];
    const count = row?.count ?? 1;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((new Date(row?.expires_at ?? Date.now()).getTime() - Date.now()) / 1000),
    );

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds,
    };
  } catch (e) {
    // A limiter outage must not become an outage of its own. "closed" is the
    // default because the routes that use this are the ones where the call
    // costs money; "open" is for routes where dropping a request is worse than
    // letting it through.
    console.error("[rate-limit] lookup failed, failing", onError, e);
    if (onError === "closed") {
      throw new HttpError(
        503,
        "Rate limiting is temporarily unavailable, try again shortly",
        "rate_limiter_unavailable",
      );
    }
    return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0 };
  }
}

/**
 * Throw 429 with the headers a well-behaved client needs.
 *
 * `identity` is supplied by the caller rather than derived here so anonymous
 * routes can bucket on IP and authenticated routes on user id, without this
 * function needing to know which it is.
 */
export async function enforceRateLimit(
  name: RateLimitName,
  identity: string,
  opts: { onError?: "open" | "closed" } = {},
): Promise<void> {
  const policy = RATE_LIMITS[name];
  const result = await consumeRateLimit(`${name}:${identity}`, policy, opts);

  if (!result.allowed) {
    throw new HttpError(
      429,
      `Too many requests. Try again in ${result.retryAfterSeconds}s.`,
      "rate_limited",
      {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    );
  }
}

/**
 * Best-effort client IP.
 *
 * There is no trustworthy client IP on a self-hosted or proxied deployment:
 * `x-forwarded-for` is a list the client can prepend to, and `x-real-ip` is set
 * by whatever proxy happens to be in front. This is documented rather than
 * hidden because it limits what per-IP limits can actually promise. Prefer
 * `userId` buckets wherever the caller is authenticated — an IP limit here is
 * only a guard against anonymous volume, not a security control.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
}

/*
 * There is deliberately no sweeper for this table. The row count is bounded by
 * tenants x policies, not by request volume, because the bucket key is a hash
 * of (policy, userId) — a single user cannot create unbounded rows. Expired
 * rows are reset in place by the CASE expression, so they are correct whether
 * or not they are deleted, and `pg_cron` can prune them later if the table ever
 * needs it. An in-request sweep was removed because it cost two extra round
 * trips on a pool configured with `connection_limit=1`.
 *
 * Measured: the runtime URL pins `connection_limit=1`, so this check holds the
 * only pooled connection while it runs and concurrent requests queue behind it.
 * Twelve simultaneous limiter calls were served without a pool timeout once the
 * connection was warm; the first burst against a cold pool did produce Prisma
 * P2024 at the 10s pool timeout. That ceiling applies to every query in the app,
 * not just this one, but this check moved onto the hot path of the upload and AI
 * routes so it now contributes to it. Widening the pool is a deliberate decision
 * about pgbouncer connection counts, not something to change quietly.
 */
