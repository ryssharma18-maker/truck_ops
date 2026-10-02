import { readFileSync } from "node:fs";
import path from "node:path";
import {
  detectDocumentMime,
  MAX_MULTIPART_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  parseMultipartFormData,
  readValidatedUpload,
  validateDocumentContent,
} from "../lib/uploadSecurity";

let checks = 0;
let failures = 0;

function check(name: string, condition: boolean): void {
  checks++;
  if (condition) console.log(`  [ok]   ${name}`);
  else {
    failures++;
    console.error(`  [FAIL] ${name}`);
  }
}

function caughtCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

async function main(): Promise<void> {
  console.log("Document content signatures");
  const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
  const malformedPdf = new TextEncoder().encode("%PDF-1.7\n");
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9,
  ]);
  const png = new Uint8Array(58);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngView = new DataView(png.buffer);
  pngView.setUint32(8, 13, false);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  pngView.setUint32(16, 1, false);
  pngView.setUint32(20, 1, false);
  png[24] = 8;
  png[25] = 2;
  pngView.setUint32(33, 1, false);
  png.set([0x49, 0x44, 0x41, 0x54], 37);
  pngView.setUint32(46, 0, false);
  png.set([0x49, 0x45, 0x4e, 0x44], 50);
  const webp = new Uint8Array(22);
  webp.set([0x52, 0x49, 0x46, 0x46, 14, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  webp.set([0x56, 0x50, 0x38, 0x20, 1, 0, 0, 0], 12);
  const malformedPng = png.subarray(0, 33);
  const tiff = Uint8Array.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const heic = new Uint8Array(24);
  new DataView(heic.buffer).setUint32(0, 16, false);
  heic.set([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 4);
  heic.set([0, 0, 0, 8, 0x6d, 0x65, 0x74, 0x61], 16);

  check("PDF signature and terminal marker are recognized", detectDocumentMime(pdf) === "application/pdf");
  check("JPEG signature is recognized", detectDocumentMime(jpeg) === "image/jpeg");
  check("PNG signature and IHDR are recognized", detectDocumentMime(png) === "image/png");
  check("WebP RIFF signature and length are recognized", detectDocumentMime(webp) === "image/webp");
  check("TIFF byte order and image directory are recognized", detectDocumentMime(tiff) === "image/tiff");
  check("HEIC file-type box is recognized", detectDocumentMime(heic) === "image/heic");
  check("truncated PNG data is rejected", detectDocumentMime(malformedPng) === null);
  check(
    "generic browser MIME is replaced by detected PDF MIME",
    validateDocumentContent(pdf, "application/octet-stream") === "application/pdf",
  );
  check(
    "declared MIME mismatch is rejected",
    caughtCode(
      (() => {
        try {
          validateDocumentContent(pdf, "image/png");
        } catch (error) {
          return error;
        }
      })(),
    ) === "invalid_file_content",
  );
  check(
    "malformed PDF is rejected",
    caughtCode(
      (() => {
        try {
          validateDocumentContent(malformedPdf, "application/pdf");
        } catch (error) {
          return error;
        }
      })(),
    ) === "invalid_file_content",
  );
  check(
    "unsupported MIME such as SVG is rejected",
    caughtCode(
      (() => {
        try {
          validateDocumentContent(new TextEncoder().encode("<svg/>"), "image/svg+xml");
        } catch (error) {
          return error;
        }
      })(),
    ) === "unsupported_file_type",
  );
  check(
    "unknown content is rejected even with a generic MIME",
    caughtCode(
      (() => {
        try {
          validateDocumentContent(new TextEncoder().encode("not a document"), "");
        } catch (error) {
          return error;
        }
      })(),
    ) === "unsupported_file_type",
  );

  console.log("\nBounded request and file parsing");
  const oversizedBackingFile = new File([], "large.pdf", { type: "application/pdf" });
  const fakeOversizedFile = new Proxy(oversizedBackingFile, {
    get(target, property, receiver) {
      if (property === "size") return MAX_UPLOAD_FILE_BYTES + 1;
      return Reflect.get(target, property, receiver);
    },
  });
  let oversizedCode: string | undefined;
  try {
    await readValidatedUpload(fakeOversizedFile);
  } catch (error) {
    oversizedCode = caughtCode(error);
  }
  check("per-file size is rejected before reading its bytes", oversizedCode === "file_too_large");

  const multipart = new FormData();
  multipart.set("file", new Blob([pdf], { type: "application/pdf" }), "rate.pdf");
  const parsed = await parseMultipartFormData(
    new Request("https://truckops.invalid/upload", {
      method: "POST",
      body: multipart,
    }),
  );
  const parsedFile = parsed.get("file");
  check("valid multipart body survives bounded stream replay", parsedFile instanceof File);
  if (parsedFile instanceof File) {
    const upload = await readValidatedUpload(parsedFile);
    check("parsed PDF is validated and gets a canonical MIME", upload.mimeType === "application/pdf");
  }

  let requestLimitCode: string | undefined;
  try {
    const oversizedBody = new Blob([new Uint8Array(MAX_MULTIPART_BODY_BYTES + 1)]);
    await parseMultipartFormData(
      new Request("https://truckops.invalid/upload", {
        method: "POST",
        body: oversizedBody,
      }),
    );
  } catch (error) {
    requestLimitCode = caughtCode(error);
  }
  check(
    "actual streamed request bytes are capped before multipart parsing",
    requestLimitCode === "request_too_large",
  );

  console.log("\nRoute and cleanup contracts");
  const uploadRoutes = [
    "app/api/documents/upload/route.ts",
    "app/api/shipping/documents/upload/route.ts",
    "app/api/ai/parse-rate-confirm/route.ts",
  ];
  for (const file of uploadRoutes) {
    const route = source(file);
    const authIndex = route.indexOf("requireUser()");
    const limitIndex = route.indexOf("enforceRateLimit(");
    const parseIndex = route.indexOf("parseMultipartFormData(req)");
    const validateIndex = route.indexOf("readValidatedUpload(file)");
    check(
      `${file} authenticates and rate-limits before parsing and validates file content`,
      authIndex >= 0 &&
        limitIndex > authIndex &&
        parseIndex > limitIndex &&
        validateIndex > parseIndex,
    );
  }

  const documentRoute = source("app/api/documents/upload/route.ts");
  const shippingRoute = source("app/api/shipping/documents/upload/route.ts");
  check(
    "both storage upload routes write canonical detected MIME values",
    documentRoute.includes("uploadFile(path, bytes, mimeType)") &&
      documentRoute.includes("mimeType,") &&
      shippingRoute.includes("uploadFile(path, bytes, mimeType)"),
  );
  check(
    "database write failures clean only the exact uploaded object",
    documentRoute.includes("withUploadCleanup(fileUrl") &&
      shippingRoute.includes("withUploadCleanup(fileUrl") &&
      source("lib/services/storageService.ts").includes('method: "DELETE"'),
  );
  check(
    "AI service validates stored bytes and declared MIME before provider processing",
    source("lib/services/aiService.ts").indexOf("validateDocumentContent(bytes, mimeType)") <
      source("lib/services/aiService.ts").indexOf("model.generateContent"),
  );

  console.log(`\n${checks - failures}/${checks} upload-security checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Upload security verification failed:", error);
  process.exitCode = 1;
});
