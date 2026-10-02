import { HttpError } from "@/lib/errors";

const BUCKET = "documents";
let ensured = false;

function base(): string {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!u) throw new HttpError(500, "NEXT_PUBLIC_SUPABASE_URL is not set");
  return u.replace(/\/+$/, "");
}
function key(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new HttpError(500, "SUPABASE_SERVICE_ROLE_KEY is not set");
  return k;
}

async function ensureBucket() {
  if (ensured) return;
  const h = { apikey: key(), Authorization: `Bearer ${key()}` };
  const get = await fetch(`${base()}/storage/v1/bucket/${BUCKET}`, {
    headers: h,
  });
  if (get.ok) {
    ensured = true;
    return;
  }
  const create = await fetch(`${base()}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (!create.ok && create.status !== 409) {
    throw new HttpError(
      500,
      `Could not create storage bucket "${BUCKET}": ${(await create.text()).slice(0, 200)}`,
    );
  }
  ensured = true;
}

export async function uploadFile(
  path: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  await ensureBucket();
  const res = await fetch(`${base()}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    // Copy into a fresh ArrayBuffer-backed view: `fetch` rejects a Node Buffer
    // as BodyInit under the DOM lib typings, and this also detaches the
    // caller's buffer from the request.
    body: new Uint8Array(data),
  });
  if (!res.ok)
    throw new HttpError(
      500,
      `Upload failed: ${(await res.text()).slice(0, 200)}`,
    );
  return `${BUCKET}/${path}`;
}

function encodedObjectKey(storedPath: string): string {
  const objectKey = storedPath.startsWith(`${BUCKET}/`)
    ? storedPath.slice(BUCKET.length + 1)
    : storedPath;
  const segments = objectKey.split("/");
  if (
    !objectKey ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new HttpError(500, "Invalid storage object key", "invalid_storage_key");
  }
  return segments.map(encodeURIComponent).join("/");
}

/** Delete one known object key; this is not a prefix or bucket cleanup. */
export async function deleteFile(storedPath: string): Promise<void> {
  const res = await fetch(
    `${base()}/storage/v1/object/${BUCKET}/${encodedObjectKey(storedPath)}`,
    {
      method: "DELETE",
      headers: { apikey: key(), Authorization: `Bearer ${key()}` },
    },
  );
  if (!res.ok) {
    throw new HttpError(
      500,
      "Could not remove the uploaded file after a failed database write",
      "storage_cleanup_failed",
    );
  }
}

/**
 * Keep a single uploaded object from being orphaned when its database row
 * cannot be created. Cleanup is restricted to the exact returned object key.
 */
export async function withUploadCleanup<T>(
  storedPath: string,
  createRecord: () => Promise<T>,
): Promise<T> {
  try {
    return await createRecord();
  } catch (error) {
    try {
      await deleteFile(storedPath);
    } catch (cleanupError) {
      console.error(
        "[storage] exact-object cleanup failed",
        cleanupError instanceof Error ? cleanupError.name : "unknown",
      );
      throw cleanupError;
    }
    throw error;
  }
}

export async function downloadFile(storedPath: string): Promise<Buffer> {
  const p = storedPath.startsWith(`${BUCKET}/`)
    ? storedPath.slice(BUCKET.length + 1)
    : storedPath;
  const res = await fetch(`${base()}/storage/v1/object/${BUCKET}/${p}`, {
    headers: { apikey: key(), Authorization: `Bearer ${key()}` },
  });
  if (!res.ok)
    throw new HttpError(
      404,
      `File not found in storage: ${(await res.text()).slice(0, 200)}`,
    );
  return Buffer.from(await res.arrayBuffer());
}

export async function signedUrl(
  storedPath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const p = storedPath.startsWith(`${BUCKET}/`)
    ? storedPath.slice(BUCKET.length + 1)
    : storedPath;
  const res = await fetch(`${base()}/storage/v1/object/sign/${BUCKET}/${p}`, {
    method: "POST",
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!res.ok)
    throw new HttpError(
      500,
      `Could not sign URL: ${(await res.text()).slice(0, 200)}`,
    );
  const j: any = await res.json();
  return `${base()}/storage/v1${j.signedURL}`;
}
