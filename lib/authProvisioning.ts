import { HttpError } from "@/lib/errors";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the existing Supabase auth trigger to provision its public.users row.
 * This helper only reads; the database trigger remains the single profile creator.
 */
export async function waitForProvisionedProfile<T>(
  findProfile: () => Promise<T | null>,
  options: {
    attempts?: number;
    delayMs?: number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 120;
  const wait = options.wait ?? sleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const profile = await findProfile();
      if (profile) return profile;
    } catch (error) {
      lastError = error;
    }

    if (attempt + 1 < attempts) await wait(delayMs);
  }

  if (lastError) {
    console.error("[signup] profile provisioning lookup failed", lastError);
    throw new HttpError(
      503,
      "Account setup is temporarily unavailable. Please retry shortly.",
      "profile_provisioning_unavailable",
    );
  }

  throw new HttpError(
    503,
    "Account setup is still processing. Please retry shortly.",
    "profile_provisioning_pending",
  );
}
