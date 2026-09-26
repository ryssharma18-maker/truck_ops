/**
 * One-off: re-own the seeded demo dataset from the orphaned demo row to a real
 * Supabase auth user.
 *
 * demo@truckops.ai was a fabricated public.users row with the hand-written id
 * d0000000-0000-0000-0000-000000000001 and no auth.users counterpart, so no
 * login could ever succeed. This moves its data to the chosen real account.
 *
 *   node scripts/reassign-demo-data.cjs <targetEmail>
 */

const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const TABLES = [
  "shipping_invoices", "shipping_documents", "shipping_manifests",
  "shipping_containers", "shipping_bookings", "shipping_vessels",
  "shipping_ports", "invoices", "detention_records", "documents",
  "ifta_records", "loads", "drivers", "trucks", "brokers",
  "compliance_documents", "email_logs", "notifications", "subscriptions",
];

const ORPHAN_EMAIL = "demo@truckops.ai";
const ORPHAN_ID = "d0000000-0000-0000-0000-000000000001";

async function main() {
  const targetEmail = process.argv[2];
  if (!targetEmail) {
    console.error("usage: node scripts/reassign-demo-data.cjs <targetEmail>");
    process.exit(1);
  }

  const target = await p.user.findUnique({ where: { email: targetEmail } });
  if (!target) {
    console.error("no public.users row for " + targetEmail);
    process.exit(1);
  }
  if (target.id === ORPHAN_ID) {
    console.error("target is the orphan row itself; nothing to do");
    process.exit(1);
  }
  console.log("target: " + targetEmail + "  (" + target.id + ")");

  const orphan = await p.user.findUnique({ where: { email: ORPHAN_EMAIL } });
  if (!orphan || orphan.id !== ORPHAN_ID) {
    console.log("no orphan row to move; nothing to do");
    await p.$disconnect();
    return;
  }

  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";

  // The pooler adds enough round-trip latency that the 5s default aborts
  // after a handful of statements.
  const moved = await p.$transaction(
    async (tx) => {
      const counts = {};
      for (const t of TABLES) {
        const r = await tx.$executeRawUnsafe(
          `UPDATE ${t} SET user_id = ${q(target.id)} WHERE user_id = ${q(ORPHAN_ID)}`,
        );
        counts[t] = r;
      }
      await tx.user.delete({ where: { id: ORPHAN_ID } });
      return counts;
    },
    { timeout: 120000, maxWait: 30000 },
  );

  console.log("\nrows moved:");
  for (const [t, n] of Object.entries(moved)) {
    if (n) console.log("  " + t.padEnd(22) + n);
  }
  console.log("\ndeleted orphan public.users row " + ORPHAN_ID);

  const after = {};
  for (const t of TABLES) {
    const r = await p.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM ${t} WHERE user_id = ${q(target.id)}`,
    );
    if (r[0].n) after[t] = r[0].n;
  }
  console.log("\nnow owned by " + targetEmail + ":");
  for (const [t, n] of Object.entries(after)) {
    console.log("  " + t.padEnd(22) + n);
  }

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
