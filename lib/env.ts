/**
 * Environment inspection.
 *
 * Deliberately lazy: the previous version parsed the whole environment at
 * import time and nothing imported it, so it validated `OPENAI_API_KEY` — a
 * name no code reads — while never checking `GEMINI_API_KEY`. A module that
 * runs when imported and is never imported is worse than no module, because it
 * looks like a safety net.
 *
 * Everything here is a boolean for the settings page and a hard error for the
 * one caller that genuinely needs the value. No secret is ever returned to the
 * client.
 */

const PLACEHOLDER_PREFIXES = ["placeholder", "your-", "changeme", "xxx"];

function read(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const t = v.trim();
  if (t.length === 0) return undefined;
  const lower = t.toLowerCase();
  if (PLACEHOLDER_PREFIXES.some((p) => lower.startsWith(p))) return undefined;
  if (lower === "null" || lower === "undefined") return undefined;
  return t;
}

/** True when the variable holds a plausible real value, not a placeholder. */
export function isConfigured(name: string): boolean {
  return read(name) !== undefined;
}

/** Any one of the given variables is real. */
export function anyConfigured(...names: string[]): boolean {
  return names.some(isConfigured);
}

/** Throws unless the variable is present and non-placeholder. */
export function requireEnv(name: string, purpose: string): string {
  const v = read(name);
  if (v === undefined) {
    throw new Error(
      `${name} is not configured, so ${purpose} cannot work. ` +
        `Set it in .env.local (and in your host's environment for production).`,
    );
  }
  return v;
}

/**
 * Which integrations are live, for the settings page. Never includes a key.
 *
 * Placeholder values count as not configured: a leftover
 * "placeholder-service-key" must not render as a working integration.
 */
export function integrationStatus() {
  return {
    gemini: {
      configured: isConfigured("GEMINI_API_KEY"),
      hint: "Rate con, BoL, commercial invoice and packing list extraction",
    },
    storage: {
      configured:
        isConfigured("NEXT_PUBLIC_SUPABASE_URL") &&
        isConfigured("SUPABASE_SERVICE_ROLE_KEY"),
      hint: "Document uploads and signed download URLs",
    },
    stripe: {
      configured:
        isConfigured("STRIPE_SECRET_KEY") && isConfigured("STRIPE_WEBHOOK_SECRET"),
      hint: "Subscription checkout and webhook-driven plan changes",
    },
    email: {
      configured: anyConfigured("RESEND_API_KEY", "SENDGRID_API_KEY"),
      hint: "Invoice and compliance notifications",
    },
    inbound: {
      configured:
        isConfigured("INBOUND_EMAIL_DOMAIN") &&
        anyConfigured(
          "RESEND_INBOUND_WEBHOOK_SECRET",
          "SENDGRID_INBOUND_WEBHOOK_SECRET",
        ),
      hint: isConfigured("INBOUND_EMAIL_DOMAIN")
        ? `Receiving address domain: ${read("INBOUND_EMAIL_DOMAIN")}`
        : "Set INBOUND_EMAIL_DOMAIN to the receiving domain",
    },
  };
}
