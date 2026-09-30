import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/services/stripeService";
import { HttpError } from "@/lib/errors";

/**
 * Server-side plan enforcement.
 *
 * The per-truck meter is a pricing promise, and until this existed it was only
 * enforced in the *requested* checkout quantity: a Lite account could create
 * unlimited trucks, drivers, loads and bookings through the API, and the only
 * thing that noticed was the user when they tried to upgrade. Enforcing it here
 * means the limit lives in one place and cannot be bypassed by calling the API
 * directly.
 *
 * `trial` is unlimited on purpose. A trial that blocks a carrier from entering
 * the data they are being asked to evaluate converts instead of blocking, and
 * nobody has paid for the privilege. `enterprise` has no ceiling because that
 * is what was sold.
 *
 * An unrecognised plan resolves to the most restrictive *real* plan, never to
 * unlimited. Defaulting to "no limit" would make an unexpected enum value the
 * cheapest available way to get everything for nothing.
 */

/** The thing being limited, in product terms. */
export type LimitedModel = "truck" | "driver" | "load" | "booking" | "vessel";

/** Prisma client delegates, which are not all named after the model. */
const DELEGATE: Record<LimitedModel, "truck" | "driver" | "load" | "shippingBooking" | "shippingVessel"> = {
  truck: "truck",
  driver: "driver",
  load: "load",
  booking: "shippingBooking",
  vessel: "shippingVessel",
};

const MODEL_LABEL: Record<LimitedModel, string> = {
  truck: "truck",
  driver: "driver",
  load: "load",
  booking: "booking",
  vessel: "vessel",
};

export interface PlanLimit {
  maxTrucks: number | null;
  label: string;
}

/** Resolve the fleet ceiling for a plan name. */
export function planLimit(plan: string): PlanLimit {
  if (plan === "trial") {
    return { maxTrucks: null, label: "Trial" };
  }
  const spec = PLANS.find((p) => p.plan === plan);
  if (spec) {
    // Not `spec?.maxTrucks ?? fallback`: enterprise's ceiling is a deliberate
    // `null` meaning "no limit", and `??` cannot tell that apart from a missing
    // value, so the fallback would silently cap enterprise at 5 trucks.
    return { maxTrucks: spec.maxTrucks, label: spec.label };
  }
  // Unknown plan: fall back to the most restrictive real plan, never unlimited.
  const fallback = PLANS[0]!;
  return { maxTrucks: fallback.maxTrucks, label: fallback.label };
}

/**
 * How many rows of `model` a fleet of `maxTrucks` is allowed to have.
 *
 * Trucks and vessels are metered one-for-one, because that is what the price
 * is quoted per. Drivers are one per truck. Loads and bookings accumulate over
 * time, so they scale with the fleet rather than matching it — a limit of
 * "5 loads" on a 5-truck plan would be unusable after a week.
 */
export function ceilingFor(model: LimitedModel, maxTrucks: number): number {
  switch (model) {
    case "truck":
    case "driver":
    case "vessel":
      return maxTrucks;
    case "load":
    case "booking":
      return maxTrucks * 50;
  }
}

/**
 * Throw 402 if adding `additional` more rows of `model` would exceed the plan.
 *
 * `db` is injectable so a caller already inside an interactive transaction can
 * pass its transaction client and get a consistent read.
 *
 * Scope, stated plainly: this is a metering backstop against casual and
 * accidental overuse, not a concurrency lock. Two simultaneous creates can
 * both read count=4 and both insert, landing one over the ceiling. Making it
 * exact would need a serializable transaction or a row lock held across the
 * insert, which costs a round trip on the hot path of every create for a
 * one-row overshoot. The plan ceiling is not worth that; a hard cap on a
 * metered resource would be.
 */
export async function assertWithinPlan(
  db: PrismaClient | Prisma.TransactionClient,
  user: { id: string; subscriptionPlan: string },
  model: LimitedModel,
  additional = 1,
): Promise<void> {
  const { maxTrucks, label } = planLimit(user.subscriptionPlan);
  if (maxTrucks === null) return;

  const delegate = DELEGATE[model];
  // The five delegates have identical `count` shapes but no common callable
  // signature in the generated types, so the union is not callable. The shape
  // we need is identical across all of them, so name it once and assert it.
  const countable = db[delegate] as unknown as {
    count(args: { where: { userId: string } }): Promise<number>;
  };
  const current = await countable.count({ where: { userId: user.id } });
  const ceiling = ceilingFor(model, maxTrucks);

  if (current + additional > ceiling) {
    const noun = `${ceiling} ${MODEL_LABEL[model]}${ceiling === 1 ? "" : "s"}`;
    throw new HttpError(
      402,
      `${label} covers up to ${noun}. You have ${current}. Upgrade your plan to add more.`,
      "plan_limit_reached",
    );
  }
}

/** Convenience wrapper for the common case: the module-level client. */
export async function assertCanCreate(
  user: { id: string; subscriptionPlan: string },
  model: LimitedModel,
  additional = 1,
): Promise<void> {
  return assertWithinPlan(prisma, user, model, additional);
}
