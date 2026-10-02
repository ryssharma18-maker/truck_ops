import { GoogleGenerativeAI } from "@google/generative-ai";
import { HttpError } from "@/lib/errors";
import { validateDocumentContent } from "@/lib/uploadSecurity";

const MODEL = "gemini-1.5-flash";

let client: GoogleGenerativeAI | null = null;

function genAI(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new HttpError(
      500,
      "GEMINI_API_KEY is not configured — AI extraction is unavailable",
      "ai_not_configured",
    );
  }
  client ??= new GoogleGenerativeAI(key);
  return client;
}

/** Document kinds the extractor knows how to read. */
export type ExtractableDocType =
  | "rate_confirmation"
  | "bill_of_lading"
  | "proof_of_delivery"
  | "commercial_invoice"
  | "packing_list"
  | "lumper_receipt"
  | "fuel_receipt"
  | "insurance_certificate"
  | "w9"
  | "mc_authority"
  | "driver_license"
  | "other";

const FIELD_SPEC: Record<ExtractableDocType, string> = {
  rate_confirmation: `{
    "load_number": string|null,
    "broker_name": string|null,
    "shipper_name": string|null,
    "consignee_name": string|null,
    "origin_city": string|null, "origin_state": string|null,
    "destination_city": string|null, "destination_state": string|null,
    "pickup_date": "YYYY-MM-DD"|null, "delivery_date": "YYYY-MM-DD"|null,
    "commodity": string|null,
    "weight_lbs": number|null,
    "rate_amount": number|null,
    "fuel_surcharge": number|null,
    "detention_free_hours": number|null,
    "detention_hourly_rate": number|null
  }`,
  bill_of_lading: `{
    "bol_number": string|null,
    "load_number": string|null,
    "shipper_name": string|null,
    "consignee_name": string|null,
    "origin_city": string|null, "origin_state": string|null,
    "destination_city": string|null, "destination_state": string|null,
    "pickup_date": "YYYY-MM-DD"|null, "delivery_date": "YYYY-MM-DD"|null,
    "commodity": string|null,
    "piece_count": number|null,
    "weight_lbs": number|null,
    "pallet_count": number|null,
    "trailer_number": string|null
  }`,
  proof_of_delivery: `{
    "load_number": string|null,
    "bol_number": string|null,
    "delivered_date": "YYYY-MM-DD"|null,
    "delivery_status": string|null,
    "pieces_delivered": number|null,
    "weight_lbs": number|null,
    "shipper_signed": boolean,
    "receiver_signed": boolean,
    "receiver_name": string|null,
    "detention_hours": number|null,
    "notes": string|null
  }`,
  commercial_invoice: `{
    "invoice_number": string|null,
    "invoice_date": "YYYY-MM-DD"|null,
    "seller_name": string|null,
    "buyer_name": string|null,
    "booking_number": string|null,
    "vessel_name": string|null,
    "voyage_number": string|null,
    "port_of_loading": string|null,
    "port_of_discharge": string|null,
    "etd": "YYYY-MM-DD"|null,
    "eta": "YYYY-MM-DD"|null,
    "freight_terms": string|null,
    "currency": string|null,
    "total_amount": number|null,
    "line_items": [{ "description": string, "quantity": number, "unit_price": number, "amount": number }]
  }`,
  packing_list: `{
    "booking_number": string|null,
    "vessel_name": string|null,
    "shipper_name": string|null,
    "consignee_name": string|null,
    "total_packages": number|null,
    "total_weight_kg": number|null,
    "total_volume_cbm": number|null,
    "marks_and_numbers": string|null,
    "line_items": [{ "description": string, "packages": number, "net_weight_kg": number, "volume_cbm": number }]
  }`,
  lumper_receipt: `{
    "load_number": string|null, "facility": string|null,
    "amount": number|null, "receipt_number": string|null, "date": "YYYY-MM-DD"|null
  }`,
  fuel_receipt: `{
    "load_number": string|null, "station": string|null, "state": string|null,
    "gallons": number|null, "price_per_gallon": number|null,
    "total_amount": number|null, "date": "YYYY-MM-DD"|null
  }`,
  insurance_certificate: `{
    "carrier_name": string|null, "policy_number": string|null,
    "coverage_amount": number|null, "effective_date": "YYYY-MM-DD"|null,
    "expiry_date": "YYYY-MM-DD"|null
  }`,
  w9: `{ "legal_name": string|null, "tin": string|null, "address": string|null, "signed_date": "YYYY-MM-DD"|null }`,
  mc_authority: `{
    "legal_name": string|null, "dot_number": string|null, "mc_number": string|null,
    "authority_type": string|null, "effective_date": "YYYY-MM-DD"|null, "expiry_date": "YYYY-MM-DD"|null
  }`,
  driver_license: `{
    "full_name": string|null, "license_number": string|null, "state": string|null,
    "class": string|null, "date_of_birth": "YYYY-MM-DD"|null, "expiry_date": "YYYY-MM-DD"|null
  }`,
  other: `{ "document_summary": string|null, "key_value_pairs": { [key: string]: string } }`,
};

const SYSTEM_PROMPT = `You extract structured data from logistics documents (trucking paperwork and maritime shipping paperwork).
Rules:
- Reply with ONE JSON object and nothing else. No markdown, no code fences, no commentary.
- Use exactly the field names given below. Do not invent fields.
- Use null for anything not present in the document. Never guess.
- Dates must be ISO "YYYY-MM-DD". Numbers must be JSON numbers, not strings.
- Strip currency symbols and thousands separators from amounts (e.g. "$1,250.00" -> 1250).
- If the document is unreadable or is not the expected kind, return {"error": "unreadable"}.`;

/** Keys whose value the extractor is expected to fill. Used for confidence. */
function expectedKeys(spec: string): string[] {
  return [...spec.matchAll(/"([a-z_0-9]+)"\s*:/g)].map((m) => m[1]!);
}

/** Rough completeness score: share of expected fields the model actually filled. */
function scoreConfidence(spec: string, data: Record<string, unknown>): number {
  const keys = expectedKeys(spec).filter((k) => !["line_items", "key_value_pairs"].includes(k));
  if (keys.length === 0) return 0;
  const filled = keys.filter((k) => {
    const v = data[k];
    return v !== null && v !== undefined && v !== "";
  }).length;
  return Math.round((filled / keys.length) * 100) / 100;
}

function stripFences(text: string): string {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseModelJson(text: string): Record<string, unknown> {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Models occasionally prepend prose; fall back to the outermost object.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new HttpError(502, "AI returned unparseable output", "ai_bad_response");
    }
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  }
}

export interface ExtractionResult {
  documentType: ExtractableDocType;
  confidence: number;
  data: Record<string, unknown>;
}

/**
 * Extract structured data from a document.
 *
 * `bytes` is the raw file; it is base64-encoded inline for the Gemini
 * multimodal API. `documentType` selects the field contract — pass the type the
 * user declared, or "other" to let the model describe whatever it finds.
 */
export async function extractDocument(
  bytes: Buffer | Uint8Array,
  mimeType: string,
  documentType: ExtractableDocType = "other",
): Promise<ExtractionResult> {
  const validatedMimeType = validateDocumentContent(bytes, mimeType);
  const spec = FIELD_SPEC[documentType] ?? FIELD_SPEC.other;
  const model = genAI().getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });

  const prompt = `${SYSTEM_PROMPT}\n\nThis document is a: ${documentType.replace(/_/g, " ")}.\nReturn exactly this shape:\n${spec}`;

  let result;
  try {
    result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: Buffer.from(bytes).toString("base64"),
          mimeType: validatedMimeType,
        },
      },
    ]);
  } catch (err) {
    console.error("[ai] Gemini request failed:", err);
    throw new HttpError(502, "AI extraction request failed", "ai_request_failed");
  }

  const data = parseModelJson(result.response.text());
  if (typeof data.error === "string") {
    throw new HttpError(422, `Could not read document: ${data.error}`, "ai_unreadable");
  }

  return { documentType, confidence: scoreConfidence(spec, data), data };
}

/**
 * Thin wrapper kept for callers that already hold base64 (e.g. an inbound email
 * attachment decoded straight from MIME). Unlike {@link extractDocument} it
 * reports failure in the return value instead of throwing, because inbound
 * email pipelines must record a `failed` extraction rather than 500.
 */
export async function extractDocumentData(
  base64Data: string,
  mimeType: string,
  documentType: ExtractableDocType = "other",
): Promise<
  | { success: true; data: Record<string, unknown>; confidence: number }
  | { success: false; error: string; data: null; confidence: 0 }
> {
  const spec = FIELD_SPEC[documentType] ?? FIELD_SPEC.other;
  const model = genAI().getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const prompt = `${SYSTEM_PROMPT}\n\nThis document is a: ${documentType.replace(/_/g, " ")}.\nReturn exactly this shape:\n${spec}`;

  try {
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType } },
    ]);
    const data = parseModelJson(result.response.text());
    return { success: true, data, confidence: scoreConfidence(spec, data) };
  } catch (err) {
    console.error("[ai] Gemini extraction failed:", err);
    return { success: false, error: "AI extraction failed", data: null, confidence: 0 };
  }
}
