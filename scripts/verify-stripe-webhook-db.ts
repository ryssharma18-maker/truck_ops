import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";

const baseUrl = process.env.WEBHOOK_TEST_BASE ?? "http://localhost:3001";
const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (secret.length === 0) {
  throw new Error("Set STRIPE_WEBHOOK_SECRET to the same local test secret as the dev server");
}

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean): void {
  checks++;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}`);
  }
}

function signedHeader(body: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function post(event: {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = JSON.stringify(event);
  const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": signedHeader(body),
    },
    body,
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function main(): Promise<void> {
  const suffix = randomUUID().replace(/-/g, "");
  const userId = randomUUID();
  const subscriptionId = `sub_hardening_${suffix}`;
  const customerId = `cus_hardening_${suffix}`;
  const eventIds = [
    `evt_hardening_created_${suffix}`,
    `evt_hardening_newer_${suffix}`,
    `evt_hardening_stale_${suffix}`,
  ];
  const eventCreated = Math.floor(Date.now() / 1000);

  try {
    await prisma.user.create({
      data: {
        id: userId,
        email: `hardening-${suffix}@example.invalid`,
        inboxEmail: `fleet-${suffix.slice(0, 8)}@inbox.truckops.ai`,
      },
    });

    const subscription = (status: string) => ({
      id: subscriptionId,
      customer: customerId,
      status,
      current_period_start: eventCreated,
      current_period_end: eventCreated + 30 * 24 * 60 * 60,
      items: { data: [{ quantity: 2, price: { unit_amount: 29900 } }] },
      metadata: { userId, plan: "pro", truckCount: "2" },
    });

    console.log("Stripe webhook database ordering and idempotency");

    const first = await post({
      id: eventIds[0]!,
      type: "customer.subscription.created",
      created: eventCreated,
      data: { object: subscription("active") },
    });
    check("signed subscription event is applied", first.status === 200 && first.body.action === "synced");

    const newer = await post({
      id: eventIds[1]!,
      type: "customer.subscription.updated",
      created: eventCreated + 2,
      data: {
        object: {
          ...subscription("past_due"),
          current_period_end: eventCreated + 60 * 24 * 60 * 60,
        },
      },
    });
    check("newer subscription state is applied", newer.status === 200 && newer.body.action === "synced");

    const duplicate = await post({
      id: eventIds[1]!,
      type: "customer.subscription.updated",
      created: eventCreated + 2,
      data: { object: subscription("active") },
    });
    check(
      "duplicate event ID is acknowledged without reapplying",
      duplicate.status === 200 && duplicate.body.action === "already_processed",
    );

    const stale = await post({
      id: eventIds[2]!,
      type: "customer.subscription.deleted",
      created: eventCreated + 1,
      data: { object: subscription("canceled") },
    });
    check("late older deletion is acknowledged as stale", stale.status === 200 && stale.body.action === "stale_event");

    const [user, storedSubscription] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionPlan: true, lastStripeSubscriptionEventCreated: true },
      }),
      prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } }),
    ]);
    check("account state reflects the newest event", user?.subscriptionPlan === "pro");
    check(
      "subscription status and period were not reverted by the stale deletion",
      storedSubscription?.status === "past_due" &&
        storedSubscription.currentPeriodEnd.getTime() ===
          (eventCreated + 60 * 24 * 60 * 60) * 1000,
    );
    check(
      "stored event timestamp reflects the newest applied event",
      Number(user?.lastStripeSubscriptionEventCreated) === eventCreated + 2,
    );
  } finally {
    await prisma.$transaction([
      prisma.stripeEvent.deleteMany({ where: { id: { in: eventIds } } }),
      prisma.subscription.deleteMany({ where: { stripeSubscriptionId: subscriptionId } }),
      prisma.user.deleteMany({ where: { id: userId } }),
    ]);
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch(async (error: unknown) => {
  console.error("Stripe database verification failed:", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
