/**
 * Regression checks for the correctness fixes that have no existing coverage.
 *
 * Each block below corresponds to a bug that shipped: a page that 500'd, a
 * document that silently served another file's bytes, a load status that could
 * be rewound, and a receivables figure that added euros to dollars. They are
 * cheap, offline, and deterministic, so they belong in CI alongside the webhook
 * and plan-limit suites.
 *
 * Run: npm run verify:workflow
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { canTransition, nextStatuses, assertTransition } from "../lib/loadStatus";
import { storageKey } from "../lib/storageKey";
import { formatMoney } from "../lib/format";
import { totalsByCurrency, describeTotals } from "../lib/money";
import { publicProfile } from "../lib/profile";

let failures = 0;
let passes = 0;
let section = "";

function group(name: string) {
  section = name;
  console.log(`\n${name}`);
}

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  [ok]   ${label}`);
    passes++;
  } else {
    console.log(`  [FAIL] ${label}\n         expected ${e}\n         actual   ${a}`);
    failures++;
  }
}

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  [ok]   ${label}`);
    passes++;
  } else {
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

function throws(label: string, fn: () => unknown, status: number) {
  try {
    fn();
    console.log(`  [FAIL] ${label} — expected a ${status}, nothing was thrown`);
    failures++;
  } catch (e) {
    const got = (e as { status?: number }).status;
    if (got === status) {
      console.log(`  [ok]   ${label}`);
      passes++;
    } else {
      console.log(`  [FAIL] ${label} — expected status ${status}, got ${String(got)}`);
      failures++;
    }
  }
}

// ---------------------------------------------------------------- load status
group("Load status transitions");
check("pending -> in_transit", canTransition("pending", "in_transit"), true);
check("in_transit -> delivered", canTransition("in_transit", "delivered"), true);
check("delivered -> invoiced", canTransition("delivered", "invoiced"), true);
check("invoiced -> paid", canTransition("invoiced", "paid"), true);
check("invoiced -> overdue", canTransition("invoiced", "overdue"), true);
check("overdue -> paid", canTransition("overdue", "paid"), true);

check("staying put is allowed (double submit)", canTransition("paid", "paid"), true);
check(
  "dispatch correction backwards is allowed",
  canTransition("delivered", "in_transit"),
  true,
);

// The bug: the schema only checked the enum, so these all used to succeed and
// rewound the status the revenue aggregates are computed from.
check("pending -> paid rejected", canTransition("pending", "paid"), false);
check("pending -> delivered rejected", canTransition("pending", "delivered"), false);
check("paid -> pending rejected", canTransition("paid", "pending"), false);
check("paid -> in_transit rejected", canTransition("paid", "in_transit"), false);
check("delivered -> paid rejected", canTransition("delivered", "paid"), false);
check("overdue -> delivered rejected", canTransition("overdue", "delivered"), false);

check("paid is terminal", nextStatuses("paid"), []);
check("invoiced can go to paid or overdue", nextStatuses("invoiced"), ["paid", "overdue"]);

throws("assertTransition throws 409 on an illegal move", () => {
  assertTransition("pending", "paid");
}, 409);
ok("assertTransition is silent on a legal move", (() => {
  try {
    assertTransition("pending", "in_transit");
    return true;
  } catch {
    return false;
  }
})());
ok("assertTransition is silent when staying put", (() => {
  try {
    assertTransition("paid", "paid");
    return true;
  } catch {
    return false;
  }
})());

// ---------------------------------------------------------------- storage key
group("Storage object keys");
const names = [
  "rate-confirmation.pdf",
  "scan.jpeg",
  "no-extension",
  "..",
  ".",
  "",
  "../../etc/passwd",
  "a".repeat(400) + ".pdf",
  "weird name (1).PDF",
  "spaces   and\ttabs.pdf",
  "üñïçø∂é.pdf",
  "CON",
];

const keys = names.map((n) => storageKey("user-1", "documents", n));
ok("every key is unique", new Set(keys).size === keys.length);

// Zipped up front so the loop never indexes, which noUncheckedIndexedAccess
// would flag even though the two arrays are built from the same literal.
for (const [name, k] of names.map((n) => [n, storageKey("user-1", "documents", n)] as const)) {
  const label = JSON.stringify(name.slice(0, 24));
  const segments = k.split("/");
  ok(`key for ${label} is 3 segments`, segments.length === 3, k);
  ok(`key for ${label} starts with the user id`, segments[0] === "user-1");
  ok(`key for ${label} has no empty segment`, segments.every((s) => s.length > 0), k);
  ok(`key for ${label} stays under 1024 chars`, k.length <= 1024, `${k.length} chars`);
}

ok("an extension survives when there is one", /\.\w+$/.test(storageKey("u", "d", "bol.pdf")));
ok("a name with no extension still produces a key", storageKey("u", "d", "noext").length > 0);
ok(
  "a traversal attempt is flattened into one segment",
  storageKey("u", "d", "../../etc/passwd").split("/").length === 3,
);
ok(
  "an over-long name is truncated but keeps its extension",
  storageKey("u", "d", `${"a".repeat(4000)}.pdf`).endsWith(".pdf"),
);
ok(
  "two uploads of the same name in the same millisecond differ",
  storageKey("u", "d", "invoice.pdf") !== storageKey("u", "d", "invoice.pdf"),
);

// The actual bug: `${Date.now()}-${name}` collided for same-named attachments
// processed in a loop, and uploadFile sends x-upsert:true, so the second
// upload overwrote the first and both rows pointed at one object.
ok(
  "1000 same-named uploads produce 1000 distinct keys",
  new Set(Array.from({ length: 1000 }, () => storageKey("u", "inbound", "invoice.pdf"))).size ===
    1000,
);

// ------------------------------------------------------------------- money
group("formatMoney");
check("a plain USD amount", formatMoney(1234.5), "$1,234.50");
check("a null amount", formatMoney(null), "—");
check("an undefined amount", formatMoney(undefined), "—");
check("a numeric string", formatMoney("99"), "$99.00");
check("zero", formatMoney(0), "$0.00");
check("EUR", formatMoney(10, "EUR"), "€10.00");

// These used to throw RangeError out of a Server Component render, which is a
// 500 on the whole page rather than a wrong-looking cell.
ok("a two-letter code does not throw", (() => typeof formatMoney(10, "US") === "string")());
ok("an empty code does not throw", (() => typeof formatMoney(10, "") === "string")());
ok("a word does not throw", (() => typeof formatMoney(10, "dollars") === "string")());
ok("a four-letter code does not throw", (() => typeof formatMoney(10, "USDD") === "string")());
ok(
  "an unassigned code does not throw",
  (() => typeof formatMoney(10, "ZZZ") === "string")(),
);
ok("junk currency still shows the number", formatMoney(1234.5, "dollars").includes("1,234.50"));
ok("a non-numeric amount does not throw", (() => typeof formatMoney("abc") === "string")());
check("NaN renders as absent", formatMoney(Number.NaN), "—");
check("Infinity renders as absent", formatMoney(Number.POSITIVE_INFINITY), "—");

group("Currency totals");
const dec = (n: number) => ({ toNumber: () => n });

check("no groups", totalsByCurrency([]).text, "—");
check("no groups is not mixed", totalsByCurrency([]).mixed, false);

const oneUsd = totalsByCurrency([{ currency: "USD", _sum: { amount: dec(100) } }]);
check("single currency amount", oneUsd.text, "$100.00");
check("single currency is not mixed", oneUsd.mixed, false);
check("single currency has no hint", oneUsd.hint, "");

// The bug: this used to be one _sum across currencies, so EUR and USD were
// added together and the total was labelled as though it were one of them.
const mixed = totalsByCurrency([
  { currency: "USD", _sum: { amount: dec(100) } },
  { currency: "EUR", _sum: { amount: dec(250) } },
]);
check("mixed is flagged", mixed.mixed, true);
check("largest total leads", mixed.primary?.currency, "EUR");
check("sorted largest first", mixed.totals.map((t) => t.currency), ["EUR", "USD"]);
check("both currencies appear across text + hint", mixed.text === "€250.00" && mixed.hint.includes("$100.00"), true);
check("the hint names the currency count", mixed.hint.startsWith("2 currencies"), true);
check("describeTotals lists both", describeTotals(mixed), "€250.00 + $100.00");

const twoGroupsSameCode = totalsByCurrency([
  { currency: "USD", _sum: { amount: dec(100) } },
  { currency: "USD", _sum: { amount: dec(50) } },
]);
check("same-currency groups are combined", twoGroupsSameCode.text, "$150.00");
check("same-currency groups are not mixed", twoGroupsSameCode.mixed, false);

const nullSum = totalsByCurrency([{ currency: "USD", _sum: { amount: null } }]);
check("a null sum counts as zero", nullSum.text, "$0.00");

const blankCode = totalsByCurrency([{ currency: "   ", _sum: { amount: dec(10) } }]);
ok("a blank currency code keeps its own bucket", blankCode.mixed === false && blankCode.primary?.currency === "???", blankCode.text);

const junkCurrency = totalsByCurrency([
  { currency: "dollars", _sum: { amount: dec(10) } },
  { currency: "USD", _sum: { amount: dec(20) } },
]);
ok("an invalid code does not crash the total", typeof junkCurrency.text === "string", junkCurrency.text);

// ------------------------------------------------------- profile disclosure
group("Profile response allowlist");
// Asserted on the real returned keys, not by grepping source text — a regex
// over the route could not tell `serialize(user)` (leaks the row) from
// `serialize({ id, email, ... })` on an explicit literal (does not).
const userRow = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "demo@truckops.ai",
  fullName: "Demo",
  companyName: "Demo Freight",
  phone: null,
  dotNumber: null,
  mcNumber: null,
  subscriptionPlan: "pro",
  truckCount: 4,
  inboxEmail: "carrier@inbound.example",
  stripeCustomerId: "cus_SECRET123",
};
const profile = publicProfile(userRow) as unknown as Record<string, unknown>;

check("the exact set of exposed fields", Object.keys(profile).sort(), [
  "companyName",
  "dotNumber",
  "email",
  "fullName",
  "hasBillingAccount",
  "id",
  "inboxEmail",
  "mcNumber",
  "phone",
  "subscriptionPlan",
  "truckCount",
]);
ok("the stripe customer id is not a returned field", !("stripeCustomerId" in profile));
ok(
  "no returned value contains the stripe customer id",
  Object.values(profile).every((v) => !String(v).includes("cus_SECRET123")),
);
check("hasBillingAccount is true when a customer is linked", profile.hasBillingAccount, true);
check(
  "hasBillingAccount is false when not linked",
  publicProfile({ ...userRow, stripeCustomerId: null }).hasBillingAccount,
  false,
);

const profileSrc = readFileSync(
  path.resolve(process.cwd(), "app/api/user/profile/route.ts"),
  "utf8",
);
ok("route uses the shared allowlist", profileSrc.includes("publicProfile"));
ok("route no longer serializes the row", !/ok\(\s*serialize\(/.test(profileSrc));

const meSrc = readFileSync(path.resolve(process.cwd(), "app/api/auth/me/route.ts"), "utf8");
// `serialize({...})` on an explicit literal is correct — it converts Decimal —
// so only a bare identifier means the whole row is going out.
ok(
  "auth/me never serializes a bare row",
  !/serialize\(\s*(user|profile|currentUser)\b/.test(meSrc),
);
ok("auth/me omits stripeCustomerId", !meSrc.includes("stripeCustomerId"));

// -------------------------------------------------------- webhook responses
group("Webhook error responses");
const stripeSrc = readFileSync(
  path.resolve(process.cwd(), "app/api/webhooks/stripe/route.ts"),
  "utf8",
);
// It used to be `fail(\`Invalid signature: ${verdict.reason}\`...)`, and one of
// the reasons is "no webhook secret configured" — a prober's confirmation that
// the deployment is misconfigured.
ok("stripe rejection does not echo the verdict reason", !/\$\{verdict\.reason\}/.test(stripeSrc.split("verdict.ok")[1] ?? ""));
ok("stripe still logs the reason server-side", stripeSrc.includes("console.warn"));
ok("stripe still returns invalid_signature", stripeSrc.includes('"invalid_signature"'));

const inboundSrc = readFileSync(
  path.resolve(process.cwd(), "app/api/webhooks/inbound-email/route.ts"),
  "utf8",
);
ok(
  "sendgrid token compared in constant time on the JSON path",
  !/if \(sendgridSecret !== expected\)/.test(inboundSrc),
);
ok(
  "sendgrid token compared in constant time on the raw path",
  /constantTimeEqual\(secretHeader, expected\)/.test(inboundSrc),
);

// ------------------------------------------------------------- RLS coverage
// The maritime module shipped with rowsecurity = false on all seven
// shipping_* tables, even though supabase/rls-policies.sql has listed them in
// section 3 all along. Nothing detected the gap because the file and the live
// database were each individually plausible; only running the section 6 query
// against the database exposed it. The anon key ships to the browser, so that
// was a live cross-tenant read/write over every carrier's maritime data.
//
// This is a static guard so the same drift cannot reappear unnoticed: every
// model in schema.prisma that carries a user_id must be accounted for in the
// RLS script, either in the user_id policy loop or in the policy-free set.
//
// It cannot check the live database, so it is a lint on the script, not proof
// of production state. `npx tsx scripts/verify-live-db.ts` covers the runtime
// side, and the section 6 queries in the RLS script are the real audit.
group("RLS coverage of user_id tables");

const schema = readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const rls = readFileSync(path.resolve(process.cwd(), "supabase/rls-policies.sql"), "utf8");

// Model blocks, so a field named user_id elsewhere in the file cannot be picked
// up. Built with an explicit loop rather than chained regex-group access:
// noUncheckedIndexedAccess types a match group as `string | undefined`, and a
// non-null assertion would only hide that rather than handle it.
interface SchemaModel {
  name: string;
  body: string;
}
const models: SchemaModel[] = [];
for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const name = m[1];
  const body = m[2];
  if (name === undefined || body === undefined) continue;
  models.push({ name, body });
}

/** Table name a model is actually stored in. */
function tableOf(body: string, modelName: string): string {
  const mapped = body.match(/@@map\("([^"]+)"\)/);
  return mapped?.[1] ?? modelName;
}

const tenantTables = models
  .filter((m) => /^\s*userId\s+String\s+/m.test(m.body))
  .map((m) => tableOf(m.body, m.name))
  .sort();

// Tables that carry a user_id but are deliberately not in the policy loop,
// because a tenancy policy on them would be wrong rather than merely missing.
const policyFree = ["stripe_events"];

// Tables covered by their own hand-written policy instead of the loop.
// subscriptions is read-only for the user on purpose: only the Stripe webhook
// (service_role) may write a plan, so a FOR ALL loop entry would let a tenant
// upgrade themselves.
const dedicatedPolicy: Record<string, string> = {
  subscriptions: "subscriptions_select_own",
};

for (const t of tenantTables) {
  if (policyFree.includes(t)) {
    ok(`${t} is listed as deliberately policy-free`, rls.includes(t));
    continue;
  }
  if (dedicatedPolicy[t]) {
    ok(`${t} keeps its dedicated ${dedicatedPolicy[t]} policy`, rls.includes(dedicatedPolicy[t]));
    ok(`${t} dedicated policy is read-only`, new RegExp(`${dedicatedPolicy[t]}[\\s\\S]{0,120}FOR SELECT`).test(rls));
    continue;
  }
  const inLoop = new RegExp(`'${t}'`).test(rls.split("-- subscriptions:")[0] ?? rls);
  ok(`${t} appears in the RLS policy list`, inLoop);
}

// The inverse: a table named in the policy list that no longer exists in the
// schema is a stale entry, and usually means a rename was only half-applied.
const known = new Set(models.map((m) => tableOf(m.body, m.name)));
const namedInRls = [
  ...rls.matchAll(/'(shipping_[a-z_]+|detention_records|compliance_documents|ifta_records|email_logs|notifications|subscriptions)'/g),
]
  .map((m) => m[1])
  .filter((t): t is string => t !== undefined);
for (const t of new Set(namedInRls)) {
  ok(`${t} named in the RLS script still exists in the schema`, known.has(t));
}

ok("policy-free tables are not also in the user_id loop", policyFree.every((t) => {
  const head = rls.split("-- subscriptions:")[0] ?? "";
  const loop = head.slice(head.indexOf("tables TEXT[]"));
  return !(new RegExp(`'${t}'`).test(loop));
}));

ok("tables with a dedicated policy are not also in the user_id loop",
  Object.keys(dedicatedPolicy).every((t) => {
    const head = rls.split("-- subscriptions:")[0] ?? "";
    const loop = head.slice(head.indexOf("tables TEXT[]"));
    return !(new RegExp(`'${t}'`).test(loop));
  }));

// ------------------------------------------------------------------- report
console.log(`\n${passes} passed, ${failures} failed.`);
if (failures > 0) {
  console.error(`\n${section} section had failures.`);
  process.exit(1);
}
console.log("All checks passed.");
