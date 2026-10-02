# Phase 1 auth and upload security hardening

## Signup path

The signup form now posts email/password to `/api/auth/signup`. This keeps
self-service signup and its existing email-confirmation flow while applying
the route's server-side validation and named per-IP rate limit to UI signups.
The signup schema allows the current email/password-only UI payload and still
accepts the optional full name, company name, phone, and truck count fields.
Unknown identity or tenant identifiers are discarded by Zod and never used to
choose an account owner.

The endpoint still calls Supabase Auth using the request-scoped
`@supabase/ssr` server client. That client writes an established session through
the Next.js cookie store; the same-origin browser request accepts those
`Set-Cookie` values. When Supabase returns no session, the endpoint retains
`needsEmailConfirmation: true` and the UI keeps the current confirmation
message. Duplicate-email provider outcomes are normalized to the generic
`400 signup_failed` response. The profile trigger remains the only profile
creator; signup waits for the resulting row and returns a retryable 503 if it
cannot be observed.

These cookie and provider behaviors are covered by source/contract checks, not
by a live Supabase signup. Confirm both confirmation-enabled and immediate
session signup in a non-production Supabase project before release.

## Upload request limits and file validation

The three upload/AI routes authenticate and apply their existing named rate
limits before reading the body. They count actual `Request.body` stream bytes
up to 16 MiB and reject an over-limit body **before invoking the multipart
parser**. This is an application-level bound on route-side multipart parsing;
it bounds the body replayed into that parser. It is not a hard process-memory
or network-ingress limit: a runtime may already have accepted or buffered
data, including a large individual stream chunk, before route code can inspect
it. The per-file 15 MiB check still occurs immediately after `formData()`
because multipart parsing is what produces the `File` object.

No Vercel project configuration or deployed request-size setting was verified
for this repository. The effective limit at the hosting ingress therefore
remains unverified; do not treat the 16 MiB route-stream cap as proof that a
15 MiB file can reach the handler in production. Large uploads may eventually
need a direct-to-private-Storage flow with server-side finalization.

Files must be non-empty and match supported PDF, JPEG, PNG, WebP, HEIC/HEIF, or
TIFF signatures. Declared MIME types must match detected content (a missing or
generic browser MIME is resolved from the bytes); unsupported formats such as
SVG are rejected before Storage or AI processing. Stored-document AI
extraction revalidates content before calling Gemini.

If creation of a database document row fails after storage succeeds, the
route deletes only the exact object key returned for that upload. A cleanup
failure is logged without raw error details and returned as an explicit
storage-cleanup error; no bucket or prefix deletion is used.

## Verification boundary

`npm run verify:upload-security` checks content signatures, MIME mismatch,
per-file limits before byte reads, actual streamed request-size enforcement
before multipart parsing, and source ordering for auth/rate-limit/validation,
AI, and exact-object cleanup. It is credential-free and does not contact
Supabase, Storage, Gemini, or a hosting provider. It does not establish an
upstream platform body limit or perform a live Storage cleanup.
