/**
 * Minimal RFC 5322 / MIME reader for inbound email webhooks.
 *
 * Deliberately dependency-free: the inbound providers hand us either a raw
 * `message/rfc822` body or a parsed JSON envelope, and all we need is headers,
 * the text body, and attachment bytes. Adding `postal-mime` / `imapflow` for
 * this would be more surface area than the job requires.
 *
 * Handles: multipart/alternative, multipart/mixed, quoted-printable, base64,
 * RFC 2047 encoded words in headers, and inline images (dropped unless
 * `keepInline` is set).
 */

export interface EmailAttachment {
  fileName: string;
  mimeType: string;
  /** Raw bytes, decoded from the transfer encoding. */
  bytes: Buffer;
  contentId: string | null;
}

export interface ParsedEmail {
  from: string;
  fromName: string | null;
  to: string[];
  subject: string | null;
  date: Date | null;
  messageId: string | null;
  textBody: string;
  attachments: EmailAttachment[];
}

interface Part {
  headers: Map<string, string>;
  body: Buffer;
}

const CRLF = Buffer.from("\r\n");
const EMPTY = Buffer.alloc(0);

/** Split a MIME body on its boundary delimiter. */
function splitOnBoundary(body: Buffer, boundary: string): Buffer[] {
  const dash = `--${boundary}`;
  const chunks: Buffer[] = [];

  let start = body.indexOf(dash);
  if (start === -1) return chunks;
  start += dash.length;

  while (start < body.length) {
    // After the delimiter comes either "--" (close) or CRLF (next part).
    const isClose = body.slice(start, start + 2).toString() === "--";
    if (isClose) break;
    if (body.slice(start, start + 2).equals(CRLF)) start += 2;
    else if (body[start] === 0x0a) start += 1;
    else break;

    const next = body.indexOf(dash, start);
    if (next === -1) {
      chunks.push(body.slice(start));
      break;
    }
    // Trim the CRLF that belongs to the delimiter, not the part content.
    let end = next;
    if (body.slice(end - 2, end).equals(CRLF)) end -= 2;
    else if (body[end - 1] === 0x0a) end -= 1;
    chunks.push(body.slice(start, end));
    start = next + dash.length;
  }

  return chunks;
}

function parseHeaders(raw: Buffer): { headers: Map<string, string>; body: Buffer } {
  // The header/body split is the first blank line, which may be CRLF or LF.
  let split = raw.indexOf("\r\n\r\n");
  let skip = 4;
  const lf = raw.indexOf("\n\n");
  if (split === -1 || (lf !== -1 && lf < split)) {
    split = lf;
    skip = 2;
  }
  if (split === -1) {
    return { headers: parseHeaderBlock(raw), body: EMPTY };
  }
  return {
    headers: parseHeaderBlock(raw.slice(0, split)),
    body: raw.slice(split + skip),
  };
}

function parseHeaderBlock(raw: Buffer): Map<string, string> {
  const headers = new Map<string, string>();
  let name: string | null = null;
  let value = "";

  const flush = () => {
    if (name) headers.set(name.toLowerCase(), value.trim());
    name = null;
    value = "";
  };

  for (const line of raw.toString("utf8").split(/\r?\n/)) {
    // Continuation lines start with whitespace.
    if (/^[ \t]/.test(line) && name) {
      value += ` ${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    flush();
    name = line.slice(0, idx).trim();
    value = line.slice(idx + 1);
  }
  flush();
  return headers;
}

function decodeQuotedPrintable(input: Buffer): Buffer {
  const text = input.toString("latin1");
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && text[i + 1] === "\n") {
      i += 1; // soft line break
      continue;
    }
    if (text[i] === "=" && text[i + 1] === "\r" && text[i + 2] === "\n") {
      i += 2;
      continue;
    }
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    out.push(text.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

/** RFC 2047 encoded words: =?charset?B|Q?text?= */
function decodeEncodedWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g,
    (_match, charset: string, encoding: string, payload: string) => {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(payload, "base64")
          : decodeQuotedPrintable(Buffer.from(payload, "latin1"));
      return bytes.toString(charset.toLowerCase() === "utf-8" ? "utf8" : "latin1");
    },
  );
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value.replace(/\s+/g, ""), "base64");
}

function headerParam(headers: Map<string, string>, key: string): string | null {
  const value = headers.get(key);
  if (!value) return null;
  const match = value.match(/name="?([^";]+)"?/i);
  return match ? decodeEncodedWords(match[1]!.trim()) : null;
}

function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  return match ? match[1]!.trim() : null;
}

function walk(
  part: Part,
  depth: number,
  acc: { text: string[]; attachments: EmailAttachment[] },
  keepInline: boolean,
) {
  if (depth > 5) return; // guard against pathological nesting

  const contentType = (part.headers.get("content-type") ?? "text/plain").toLowerCase();
  const encoding = (part.headers.get("content-transfer-encoding") ?? "7bit")
    .trim()
    .toLowerCase();

  if (contentType.startsWith("multipart/")) {
    const boundary = boundaryOf(part.headers.get("content-type"));
    if (!boundary) return;
    for (const chunk of splitOnBoundary(part.body, boundary)) {
      const { headers, body } = parseHeaders(chunk);
      walk({ headers, body }, depth + 1, acc, keepInline);
    }
    return;
  }

  const decoded =
    encoding === "base64"
      ? decodeBase64(part.body.toString("latin1"))
      : encoding === "quoted-printable"
        ? decodeQuotedPrintable(part.body)
        : part.body;

  const disposition = (part.headers.get("content-disposition") ?? "").toLowerCase();
  const isAttachment = disposition.includes("attachment");
  const isInline = disposition.includes("inline");
  const fileName =
    headerParam(part.headers, "content-disposition") ??
    headerParam(part.headers, "content-type") ??
    null;

  if (isAttachment || (isInline && fileName && keepInline)) {
    acc.attachments.push({
      fileName: fileName ?? `attachment-${acc.attachments.length + 1}`,
      mimeType: (part.headers.get("content-type") ?? "application/octet-stream")
        .split(";")[0]!
        .trim(),
      bytes: decoded,
      contentId: part.headers.get("content-id")?.replace(/^<|>$/g, "") ?? null,
    });
    return;
  }

  if (contentType.startsWith("text/plain")) {
    acc.text.push(decoded.toString("utf8"));
  } else if (contentType.startsWith("text/html") && acc.text.length === 0) {
    // Keep the HTML as a last resort when there is no plain-text alternative.
    acc.text.push(decoded.toString("utf8").replace(/<[^>]+>/g, " "));
  }
}

function addressesOf(value: string | undefined): string[] {
  if (!value) return [];
  return decodeEncodedWords(value)
    .split(",")
    .map((chunk) => {
      const angle = chunk.match(/<([^>]+)>/);
      return (angle ? angle[1]! : chunk).trim().toLowerCase();
    })
    .filter((a) => a.includes("@"));
}

/** Parse a raw RFC 5322 message into headers, body text and attachments. */
export function parseEmail(raw: Buffer): ParsedEmail {
  const { headers, body } = parseHeaders(raw);
  const acc: { text: string[]; attachments: EmailAttachment[] } = {
    text: [],
    attachments: [],
  };
  walk({ headers, body }, 0, acc, false);

  const fromHeader = decodeEncodedWords(headers.get("from") ?? "");
  const named = fromHeader.match(/^\s*"?(.*?)"?\s*</);
  const dateHeader = headers.get("date");

  return {
    from: addressesOf(fromHeader)[0] ?? "",
    fromName: named?.[1]?.trim() ?? null,
    to: addressesOf(headers.get("to")),
    subject: headers.get("subject")
      ? decodeEncodedWords(headers.get("subject")!)
      : null,
    date: dateHeader ? new Date(dateHeader) : null,
    messageId: headers.get("message-id")?.replace(/^<|>$/g, "") ?? null,
    textBody: acc.text.join("\n\n").trim(),
    attachments: acc.attachments,
  };
}

/** Prefer the file extension a provider gave us; fall back to the MIME type. */
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/tiff": "tiff",
};

export function extensionFor(fileName: string, mimeType: string): string {
  // A leading dot alone does not count — "invoice" has no extension, and
  // treating its whole basename as one would win over the MIME type.
  const dot = fileName.lastIndexOf(".");
  if (dot > 0 && dot < fileName.length - 1) {
    const fromName = fileName.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  }
  return EXT_BY_MIME[mimeType.toLowerCase()] ?? "bin";
}

/** Guess a document type from the file name and the subject line. */
export function classifyDocument(
  fileName: string,
  subject: string | null,
): string {
  const hay = `${fileName} ${subject ?? ""}`.toLowerCase();

  const rules: [RegExp, string][] = [
    [/bill of lading|\bb-?l\b|\bbol\b|master bill/, "bill_of_lading"],
    [/proof of delivery|\bpod\b|delivery receipt/, "proof_of_delivery"],
    [/rate conf|ratecon|rate sheet|rate agreement|tender/, "rate_confirmation"],
    [/packing list|packlist|packinglist/, "packing_list"],
    [/commercial invoice|proforma|freight invoice/, "commercial_invoice"],
    [/certificat.*origin|\bcoo\b/, "certificate_of_origin"],
    [/customs|entry summ|declaration/, "customs_declaration"],
    [/lumper/, "lumper_receipt"],
    [/fuel|petrol|diesel receipt/, "fuel_receipt"],
    [/certificate of insurance|\bcoi\b|insurance cert/, "insurance_certificate"],
    [/\bw-?9\b|form w9/, "w9"],
    [/mc authority|operating authority/, "mc_authority"],
    [/driver.?s licen[cs]e|\bcdl\b/, "driver_license"],
  ];

  for (const [pattern, type] of rules) {
    if (pattern.test(hay)) return type;
  }
  return "other";
}
