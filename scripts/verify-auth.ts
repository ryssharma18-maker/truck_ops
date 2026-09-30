import { supabaseAuthFailure } from "../lib/authFailures";
import { waitForProvisionedProfile } from "../lib/authProvisioning";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean): void {
  checks++;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}`);
  }
}

console.log("Authentication error classification");

const unauthenticated = supabaseAuthFailure({ status: 401 });
check("invalid session is 401", unauthenticated.status === 401);

const missingSession = supabaseAuthFailure({ name: "AuthSessionMissingError" });
check("missing session is 401", missingSession.status === 401);

const invalidToken = supabaseAuthFailure({ status: 400, code: "bad_jwt" });
check("invalid JWT is 401", invalidToken.status === 401);

const forbidden = supabaseAuthFailure({ status: 403 });
check("provider authorization failure is 403", forbidden.status === 403);

const unexpectedClientError = supabaseAuthFailure({ status: 400, message: "bad request" });
check("non-auth provider error is not mislabeled as 401", unexpectedClientError.status === 503);

const providerFailure = supabaseAuthFailure({
  status: 500,
  message: "internal database connection string must not leak",
});
check("provider failure is 503", providerFailure.status === 503);
check(
  "provider details are not exposed",
  !providerFailure.message.includes("connection string"),
);

console.log("\nSignup profile provisioning");

async function main(): Promise<void> {
  const profile = { id: "profile-1" };
  let reads = 0;
  const provisioned = await waitForProvisionedProfile(
    async () => (++reads === 1 ? null : profile),
    { attempts: 3, wait: async () => undefined },
  );
  check("waits until the trigger-created profile is visible", provisioned === profile);
  check("retries profile reads after initial invisibility", reads === 2);

  const repeated = await waitForProvisionedProfile(async () => profile, {
    attempts: 1,
    wait: async () => undefined,
  });
  check("a repeated signup reuses the existing profile", repeated.id === profile.id);

  let pendingError: unknown;
  try {
    await waitForProvisionedProfile(async () => null, {
      attempts: 3,
      wait: async () => undefined,
    });
  } catch (error) {
    pendingError = error;
  }
  check(
    "missing profile cannot produce signup success and is retryable",
    typeof pendingError === "object" &&
      pendingError !== null &&
      "status" in pendingError &&
      pendingError.status === 503 &&
      "code" in pendingError &&
      pendingError.code === "profile_provisioning_pending",
  );

  let recoverableReads = 0;
  const recovered = await waitForProvisionedProfile(
    async () => {
      recoverableReads++;
      if (recoverableReads === 1) throw new Error("transient database failure");
      return profile;
    },
    { attempts: 2, wait: async () => undefined },
  );
  check("transient profile lookup failure is retried", recovered === profile);

  const originalConsoleError = console.error;
  console.error = () => undefined;
  let unavailableError: unknown;
  try {
    await waitForProvisionedProfile(
      async () => {
        throw new Error("database unavailable");
      },
      { attempts: 2, wait: async () => undefined },
    );
  } catch (error) {
    unavailableError = error;
  } finally {
    console.error = originalConsoleError;
  }
  check(
    "database outage is reported as 503 without leaking details",
    typeof unavailableError === "object" &&
      unavailableError !== null &&
      "status" in unavailableError &&
      unavailableError.status === 503 &&
      "message" in unavailableError &&
      !String(unavailableError.message).includes("database unavailable"),
  );

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Auth verification failed:", error);
  process.exitCode = 1;
});
