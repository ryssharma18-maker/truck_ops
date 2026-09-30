import { randomUUID } from "node:crypto";

/**
 * Build a Storage object key for an upload.
 *
 * The previous keys were `${userId}/${Date.now()}-${sanitised file name}` in all
 * three upload paths, which collides in two ways that both end in silent data
 * loss rather than a visible error, because `uploadFile` sends `x-upsert: true`:
 *
 *  - `Date.now()` is milliseconds. A single inbound email carrying two
 *    attachments of the same name ("invoice.pdf", "invoice.pdf") is processed in
 *    a tight loop and both keys can land in the same millisecond. The second
 *    upload overwrites the first, both `Document` rows are written, and both
 *    point at one object — so the earlier document silently serves the later
 *    file's bytes.
 *  - `file.name` is attacker-controlled, and the sanitiser only replaces
 *    characters outside `[a-zA-Z0-9._-]`. Two different uploads whose names
 *    sanitise to the same string ("a b.pdf" and "a/b.pdf" both become "a_b.pdf"
 *    and "a_b.pdf") collide, and the name is unbounded in length, so a long one
 *    can push the key past the Storage path limit.
 *
 * So: a randomUUID for the actual uniqueness, and the sanitised name kept only
 * as a human-readable suffix. If the name is empty or too long after cleaning,
 * the extension alone is used, and failing that nothing at all.
 *
 * `folder` is a caller-chosen prefix ("inbound", "shipping"); it is not derived
 * from user input. `userId` scopes the key so one tenant cannot enumerate or
 * overwrite another's objects by guessing a path.
 */
export function storageKey(userId: string, folder: string, originalName: string): string {
  const cleaned = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");

  // Keep the extension only: it is what makes an object recognisable in the
  // Storage console, and it is far less likely to collide than the full name.
  const ext = /\.([a-zA-Z0-9]{1,8})$/.exec(cleaned)?.[1];

  // 80 chars leaves room for the uuid and prefix inside the 1024-char Storage
  // key limit without truncating the extension.
  const stem = cleaned.replace(/\.[a-zA-Z0-9]{1,8}$/, "").slice(0, 80);
  const readable = stem ? (ext ? `${stem}.${ext}` : stem) : (ext ? `file.${ext}` : "file");

  return `${userId}/${folder}/${randomUUID()}-${readable}`;
}
