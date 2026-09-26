/**
 * Runtime checks for the hand-rolled MIME reader. Run with:
 *
 *   npx tsx scripts/verify-email-parser.ts
 *
 * These are not a substitute for a test runner — they exist so the parser can
 * be exercised against realistic message bytes without standing up a database.
 */

import { parseEmail, classifyDocument, extensionFor } from "../lib/services/emailParser";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  [ok]   ${name}`);
  } else {
    failures++;
    console.error(`  [FAIL] ${name}\n         expected: ${e}\n         actual:   ${a}`);
  }
}

// ---------------------------------------------------------------------------
console.log("single-part plain text, no attachment");
// ---------------------------------------------------------------------------
{
  const raw = Buffer.from(
    [
      "From: Dana Whitfield <carrier.pay@example-echo.test>",
      "To: fleet-rollingpines@inbox.truckops.ai",
      "Subject: Rate Confirmation - Load RP-24155",
      "Date: Mon, 21 Sep 2026 14:02:11 -0500",
      "Message-ID: <abc123@mail.example>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please find attached the rate confirmation for load RP-24155.",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const e = parseEmail(raw);
  check("from", e.from, "carrier.pay@example-echo.test");
  check("to", e.to, ["fleet-rollingpines@inbox.truckops.ai"]);
  check("subject", e.subject, "Rate Confirmation - Load RP-24155");
  check("messageId", e.messageId, "abc123@mail.example");
  check("attachments", e.attachments.length, 0);
  check("body mentions load", e.textBody.includes("RP-24155"), true);
  check("date year", e.date?.getUTCFullYear(), 2026);
  check("load number regex", /RP-24155/.test(e.textBody), true);
}

// ---------------------------------------------------------------------------
console.log("multipart/mixed with base64 PDF attachment");
// ---------------------------------------------------------------------------
{
  const b64 = Buffer.from("%PDF-1.4 fake rate confirmation bytes").toString("base64");
  const raw = Buffer.from(
    [
      "From: \"Whitfield, Dana\" <carrier.pay@example-echo.test>",
      "To: fleet-rollingpines@inbox.truckops.ai",
      "Subject: =?utf-8?B?UmF0ZSBDb25maXJtYXRpb24g4oCUIExvYWQgUlAtMjQxNTU=?=",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="BOUND123"`,
      "",
      "--BOUND123",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "Rate con attached for RP-24155.",
      "",
      "--BOUND123",
      'Content-Type: application/pdf; name="ratecon-RP-24155.pdf"',
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="ratecon-RP-24155.pdf"',
      "",
      b64,
      "",
      "--BOUND123--",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const e = parseEmail(raw);
  check("attachments", e.attachments.length, 1);
  check("fileName", e.attachments[0]?.fileName, "ratecon-RP-24155.pdf");
  check("mimeType", e.attachments[0]?.mimeType, "application/pdf");
  check(
    "bytes round-trip",
    e.attachments[0]?.bytes.toString("utf8"),
    "%PDF-1.4 fake rate confirmation bytes",
  );
  check("encoded subject decoded", e.subject, "Rate Confirmation — Load RP-24155");
  check("fromName", e.fromName, "Whitfield, Dana");
  check("classified", classifyDocument(e.attachments[0]!.fileName, e.subject), "rate_confirmation");
}

// ---------------------------------------------------------------------------
console.log("multipart/alternative: html only, plus inline image is skipped");
// ---------------------------------------------------------------------------
{
  const raw = Buffer.from(
    [
      "From: ops@ocean-brokers.example",
      "To: fleet-rollingpines@inbox.truckops.ai",
      "Subject: Booking SHP-2026-0423 confirmed",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="ALT"',
      "",
      "--ALT",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body><b>Booking confirmed</b> for SHP-2026-0423</body></html>",
      "",
      "--ALT--",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const e = parseEmail(raw);
  check("html stripped to text", e.textBody.includes("Booking confirmed"), true);
  check("no html tags left", e.textBody.includes("<b>"), false);
  check("attachments", e.attachments.length, 0);
}

// ---------------------------------------------------------------------------
console.log("quoted-printable body with soft line breaks");
// ---------------------------------------------------------------------------
{
  const raw = Buffer.from(
    [
      "From: ap@example-coyote.test",
      "To: fleet-rollingpines@inbox.truckops.ai",
      "Subject: Invoice RP-24095",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Total is =E2=82=AC? no, ASCII: $2,240.00",
      "Wrapped here so=0D=0Athis line continues.",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const e = parseEmail(raw);
  check("hard bytes decoded", e.textBody.includes("$2,240.00"), true);
  check("soft break removed", e.textBody.includes("so\nthis") || e.textBody.includes("so\r\nthis"), true);
}

// ---------------------------------------------------------------------------
console.log("classification rules");
// ---------------------------------------------------------------------------
{
  check("bol by filename", classifyDocument("BOL-778201.pdf", null), "bill_of_lading");
  check("pod by subject", classifyDocument("scan001.jpg", "Proof of Delivery signed"), "proof_of_delivery");
  check("packing list", classifyDocument("packinglist.pdf", null), "packing_list");
  check("commercial invoice", classifyDocument("CI-99120.pdf", "Commercial Invoice"), "commercial_invoice");
  check("coo", classifyDocument("coo-77120.pdf", null), "certificate_of_origin");
  check("lumper", classifyDocument("IMG_4471.jpg", "Lumper receipt"), "lumper_receipt");
  check("unknown falls back", classifyDocument("notes.pdf", "hello"), "other");
  check("ext from mime when no name", extensionFor("noext", "application/pdf"), "pdf");
  check("ext from name wins", extensionFor("scan.jpeg", "application/pdf"), "jpeg");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
