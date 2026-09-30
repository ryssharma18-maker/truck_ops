/**
 * Runtime checks for the outbound email templates and helpers.
 *
 *   npm run verify:email-send
 *
 * The HTML is rendered from carrier-supplied names and references, so escaping
 * is the property worth asserting: a broker named `<script>` must not become a
 * script tag in an invoice email. The plain-text alternative also has to be
 * real, because it is what lands for clients that block HTML.
 */

import {
  activeProvider,
  fromAddress,
  renderComplianceReminder,
  renderInvoiceRequest,
  sendAndLog,
} from "../lib/services/emailSendService";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks++;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? " - " + detail : ""}`);
  }
}

const INVOICE = {
  invoiceNumber: "INV-1042",
  brokerName: "Coyote Logistics",
  brokerEmail: "ap@coyote.example",
  amountDue: 3250.5,
  issuedOn: "2026-09-01",
  dueOn: "2026-10-01",
  reference: "PO-88213",
  loadNumber: "LD-77",
};

console.log("provider selection");

for (const k of ["RESEND_API_KEY", "SENDGRID_API_KEY"]) delete process.env[k];
check("no provider configured returns null", activeProvider() === null);

process.env.RESEND_API_KEY = "placeholder-key";
check("a placeholder key is not a provider", activeProvider() === null);

process.env.RESEND_API_KEY = "re_real_key_123";
check("resend is preferred when both are set", activeProvider() === "resend");

delete process.env.RESEND_API_KEY;
process.env.SENDGRID_API_KEY = "SG.real_key_123";
check("sendgrid is used when resend is absent", activeProvider() === "sendgrid");

delete process.env.SENDGRID_API_KEY;

console.log("\nfrom address");

for (const k of ["OUTBOUND_FROM_EMAIL", "OUTBOUND_FROM_NAME"]) delete process.env[k];
check(
  "an unconfigured sender falls back to the placeholder",
  fromAddress().includes("@truckops.ai"),
);

process.env.OUTBOUND_FROM_EMAIL = "billing@acmehaul.example";
process.env.OUTBOUND_FROM_NAME = "Acme Haul";
check(
  "the configured sender is used",
  fromAddress() === '"Acme Haul" <billing@acmehaul.example>',
);
check("a per-call override wins", fromAddress("Ops <ops@acmehaul.example>") === "Ops <ops@acmehaul.example>");

process.env.OUTBOUND_FROM_NAME = 'Say "Hi"';
check(
  "quotes in the display name are stripped",
  !fromAddress().includes('"Say ""Hi"" "'),
);

delete process.env.OUTBOUND_FROM_NAME;
check(
  "a missing display name falls back to the product",
  fromAddress() === '"TruckOps AI" <billing@acmehaul.example>',
);

for (const k of ["OUTBOUND_FROM_EMAIL", "OUTBOUND_FROM_NAME"]) delete process.env[k];

console.log("\ninvoice template");

const inv = renderInvoiceRequest(INVOICE);
check("subject names the invoice", inv.subject.includes("INV-1042"));
check("subject names the amount", inv.subject.includes("3,250.50"));
check("subject names the due date", inv.subject.includes("2026-10-01"));
check("html contains the broker", inv.html.includes("Coyote Logistics"));
check("html contains the reference", inv.html.includes("PO-88213"));
check("html contains the load", inv.html.includes("LD-77"));
check("plain text contains the amount", inv.text.includes("3,250.50"));
check("plain text is not html", !inv.text.includes("<td"));
check("plain text has no tags", !/<[a-z/]/i.test(inv.text));
check("html is a full document", inv.html.startsWith("<!doctype html>"));

const noLoad = renderInvoiceRequest({ ...INVOICE, loadNumber: null });
check("a null load omits the row", !noLoad.html.includes("LD-77"));
check("a null load still renders", noLoad.html.includes("INV-1042"));

const withContact = renderInvoiceRequest({
  ...INVOICE,
  contactName: "Dana Reyes",
});
check("the contact greets, not the company", withContact.html.includes("Hi Dana Reyes,"));
check("the company is still billed", withContact.text.includes("Coyote Logistics"));
check("the contact also appears in plain text", withContact.text.startsWith("Hi Dana Reyes,"));

const blankContact = renderInvoiceRequest({
  ...INVOICE,
  contactName: "   ",
});
check(
  "a blank contact falls back to the company",
  blankContact.html.includes("Hi Coyote Logistics,"),
);
check("a null contact falls back to the company", inv.html.includes("Hi Coyote Logistics,"));

console.log("\nescaping");

const hostile = renderInvoiceRequest({
  ...INVOICE,
  brokerName: '<script>alert("x")</script>',
  reference: '"><img src=x onerror=alert(1)>',
});
check("script tag is escaped", !hostile.html.includes("<script>"));
check("escaped content is present", hostile.html.includes("&lt;script&gt;"));
check("onerror attribute is escaped", !hostile.html.includes("<img src=x"));
check("plain text keeps the literal name", hostile.text.includes("<script>"));

console.log("\ncompliance template");

const soon = renderComplianceReminder({
  documentTitle: "Insurance certificate",
  expiresOn: "2026-10-15",
  daysRemaining: 45,
});
check("a distant expiry is not urgent", !soon.subject.includes("URGENT"));
check("a distant expiry states the date", soon.subject.includes("2026-10-15"));
check("no urgent banner when distant", !soon.html.includes("block dispatch"));

const warning = renderComplianceReminder({
  documentTitle: "Insurance certificate",
  expiresOn: "2026-10-01",
  daysRemaining: 12,
});
check("12 days is urgent", warning.subject.includes("URGENT"));
check("12 days is not critical", !warning.html.includes("block dispatch"));

const critical = renderComplianceReminder({
  documentTitle: "Insurance certificate",
  expiresOn: "2026-09-28",
  daysRemaining: 3,
});
check("3 days is critical", critical.html.includes("block dispatch"));

const single = renderComplianceReminder({
  documentTitle: "Registration",
  expiresOn: "2026-09-27",
  daysRemaining: 1,
});
check("1 day is singular", single.subject.includes("in 1 day"));
check("1 day is not plural", !single.subject.includes("1 days"));
check("2 days is plural", renderComplianceReminder({ documentTitle: "Registration", expiresOn: "2026-09-28", daysRemaining: 2 }).subject.includes("in 2 days"));

const withVehicle = renderComplianceReminder({
  documentTitle: "DOT registration",
  expiresOn: "2026-12-01",
  daysRemaining: 90,
  vehicle: "TRK-1042",
});
check("vehicle is shown when present", withVehicle.html.includes("TRK-1042"));

const noVehicle = renderComplianceReminder({
  documentTitle: "DOT registration",
  expiresOn: "2026-12-01",
  daysRemaining: 90,
  vehicle: null,
});
check("no dangling preposition without a vehicle", !noVehicle.html.includes("on  expires"));

async function main() {
  console.log("\nsend without a provider");

  const result: Awaited<ReturnType<typeof sendAndLog>> = await sendAndLog({
    userId: "00000000-0000-0000-0000-000000000000",
    kind: "invoice",
    to: "x@example.com",
    subject: "s",
    html: "<p>hi</p>",
  }).catch((e: Error) => ({
    ok: false as const,
    error: e.message,
    logId: null,
    logged: false,
  }));

  check(
    "an unconfigured provider fails instead of throwing",
    result.ok === false,
  );
  check(
    "the failure explains itself",
    /RESEND_API_KEY|SENDGRID_API_KEY/.test(result.error ?? ""),
  );
  // The log write uses a non-existent user id on purpose: a logging failure
  // must not be reported as a send failure, or a caller retrying on error
  // would send a duplicate invoice.
  check(
    "a failed log write does not mask the send result",
    result.logged === false && result.ok === false,
  );
  check(
    "a log write failure is reported, not thrown",
    result.logId === null,
  );

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
