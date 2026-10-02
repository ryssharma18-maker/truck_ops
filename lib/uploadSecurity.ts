import { HttpError } from "@/lib/errors";

export const MAX_UPLOAD_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_MULTIPART_BODY_BYTES = MAX_UPLOAD_FILE_BYTES + 1024 * 1024;

export type SupportedDocumentMime =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif"
  | "image/tiff";

const SUPPORTED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function hasValidPngStructure(bytes: Uint8Array): boolean {
  if (
    bytes.byteLength < 58 ||
    bytes[0] !== 0x89 ||
    ascii(bytes, 1, 3) !== "PNG" ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let hasImageData = false;
  let chunkIndex = 0;

  while (offset + 12 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, false);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > bytes.byteLength) return false;

    const chunkType = ascii(bytes, offset + 4, 4);
    if (chunkIndex === 0) {
      const width = view.getUint32(offset + 8, false);
      const height = view.getUint32(offset + 12, false);
      if (chunkType !== "IHDR" || chunkLength !== 13 || width === 0 || height === 0) {
        return false;
      }
    } else if (chunkType === "IHDR") {
      return false;
    }

    if (chunkType === "IDAT" && chunkLength > 0) hasImageData = true;
    if (chunkType === "IEND") {
      return chunkLength === 0 && hasImageData && chunkEnd === bytes.byteLength;
    }

    offset = chunkEnd;
    chunkIndex++;
  }

  return false;
}

function hasValidJpegStructure(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let hasFrame = false;

  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) return false;
    if (marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) return false;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return false;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      hasFrame = true;
    }

    if (marker === 0xda) {
      const scanStart = offset + segmentLength;
      const tailStart = Math.max(scanStart, bytes.byteLength - 64);
      for (let index = tailStart; index + 1 < bytes.byteLength; index++) {
        if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
          return hasFrame;
        }
      }
      return false;
    }

    offset += segmentLength;
  }

  return false;
}

export function detectDocumentMime(
  bytes: Uint8Array,
): SupportedDocumentMime | null {
  if (bytes.byteLength >= 8 && ascii(bytes, 0, 5) === "%PDF-") {
    const tail = ascii(bytes, Math.max(0, bytes.byteLength - 2048), Math.min(2048, bytes.byteLength));
    if (tail.includes("%%EOF")) return "application/pdf";
  }

  if (hasValidPngStructure(bytes)) {
    return "image/png";
  }

  if (hasValidJpegStructure(bytes)) {
    return "image/jpeg";
  }

  if (bytes.byteLength >= 21 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const riffEnd = view.getUint32(4, true) + 8;
    const chunkLength = view.getUint32(16, true);
    const chunkEnd = 20 + chunkLength + (chunkLength % 2);
    if (
      riffEnd === bytes.byteLength &&
      ["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes, 12, 4)) &&
      chunkLength > 0 &&
      chunkEnd <= riffEnd
    ) {
      return "image/webp";
    }
  }

  if (bytes.byteLength >= 14) {
    const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
    const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      ((littleEndian && view.getUint16(2, true) === 42) ||
        (bigEndian && view.getUint16(2, false) === 42))
    ) {
      const directoryOffset = view.getUint32(4, littleEndian);
      if (directoryOffset >= 8 && directoryOffset + 2 <= bytes.byteLength) {
        const entries = view.getUint16(directoryOffset, littleEndian);
        if (directoryOffset + 2 + entries * 12 + 4 <= bytes.byteLength) {
          return "image/tiff";
        }
      }
    }
  }

  if (bytes.byteLength >= 16 && ascii(bytes, 4, 4) === "ftyp") {
    const boxLength = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0, false);
    if (boxLength >= 16 && boxLength < bytes.byteLength) {
      const brands = [ascii(bytes, 8, 4)];
      for (let offset = 16; offset + 4 <= Math.min(boxLength, 64); offset += 4) {
        brands.push(ascii(bytes, offset, 4));
      }
      if (brands.some((brand) => ["heic", "heix", "hevc", "hevx"].includes(brand))) {
        return "image/heic";
      }
      if (brands.some((brand) => ["mif1", "msf1"].includes(brand))) {
        return "image/heif";
      }
    }
  }

  return null;
}

function normalizeDeclaredMimeType(declaredMimeType: string): string {
  return declaredMimeType.trim().toLowerCase().split(";")[0] ?? "";
}

function assertSupportedDeclaredMimeType(declared: string): boolean {
  const isGeneric = declared === "" || declared === "application/octet-stream";
  if (!isGeneric && !SUPPORTED_MIME_TYPES.has(declared)) {
    throw new HttpError(415, "Unsupported file type", "unsupported_file_type");
  }
  return isGeneric;
}

export function validateDocumentContent(
  bytes: Uint8Array,
  declaredMimeType: string,
): SupportedDocumentMime {
  if (bytes.byteLength === 0) {
    throw new HttpError(422, "The uploaded file is empty", "invalid_file_content");
  }
  if (bytes.byteLength > MAX_UPLOAD_FILE_BYTES) {
    throw new HttpError(413, "File too large (max 15 MB)", "file_too_large");
  }

  const declared = normalizeDeclaredMimeType(declaredMimeType);
  const declaredIsGeneric = assertSupportedDeclaredMimeType(declared);

  const detected = detectDocumentMime(bytes);
  if (!detected) {
    throw new HttpError(
      declaredIsGeneric ? 415 : 422,
      declaredIsGeneric ? "Unsupported file type" : "File content is malformed",
      declaredIsGeneric ? "unsupported_file_type" : "invalid_file_content",
    );
  }
  if (!declaredIsGeneric && declared !== detected) {
    throw new HttpError(422, "File content does not match its declared type", "invalid_file_content");
  }
  return detected;
}

export async function readValidatedUpload(
  file: File,
): Promise<{ bytes: Buffer; mimeType: SupportedDocumentMime }> {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new HttpError(413, "File too large (max 15 MB)", "file_too_large");
  }
  if (file.size === 0) {
    throw new HttpError(422, "The uploaded file is empty", "invalid_file_content");
  }

  assertSupportedDeclaredMimeType(normalizeDeclaredMimeType(file.type));
  const bytes = Buffer.from(await file.arrayBuffer());
  return { bytes, mimeType: validateDocumentContent(bytes, file.type) };
}

/**
 * Count the real request stream before invoking the multipart parser. This
 * bounds the body replayed into the parser, not runtime chunks or bytes already
 * accepted by an upstream platform or proxy.
 */
export async function parseMultipartFormData(req: Request): Promise<FormData> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = req.body?.getReader();

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_MULTIPART_BODY_BYTES) {
          try {
            await reader.cancel();
          } catch (error) {
            console.error(
              "[upload] request body cancellation failed",
              error instanceof Error ? error.name : "unknown",
            );
          }
          throw new HttpError(
            413,
            "Request body too large (maximum upload is 15 MB)",
            "request_too_large",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const headers = new Headers(req.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const replayableRequest = new Request(req.url, {
    method: req.method,
    headers,
    body: totalBytes > 0 ? bodyBytes.buffer : null,
  });

  try {
    return await replayableRequest.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data", "invalid_form_data");
  }
}
