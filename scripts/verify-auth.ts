import { supabaseAuthFailure } from "../lib/authFailures";
import {
  isDuplicateSignupUser,
  waitForProvisionedProfile,
} from "../lib/authProvisioning";
import { signupSchema } from "../lib/validation";
import { RATE_LIMITS } from "../lib/rateLimit";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  console.log("\nSignup input and current route contract");
  const validSignup = signupSchema.safeParse({
    email: "carrier@example.com",
    password: "secure-pass-123",
    fullName: "Carrier User",
    companyName: "Carrier LLC",
  });
  check("valid signup input is accepted", validSignup.success);
  check(
    "signup defaults truckCount to one",
    validSignup.success && validSignup.data.truckCount === 1,
  );
  check(
    "duplicate-email candidate passes input validation for provider handling",
    signupSchema.safeParse({
      email: "existing@example.com",
      password: "secure-pass-123",
      fullName: "Existing User",
      companyName: "Existing LLC",
    }).success,
  );
  check(
    "invalid email and password are rejected",
    !signupSchema.safeParse({
      email: "not-an-email",
      password: "short",
      fullName: "User",
      companyName: "Company",
    }).success,
  );
  check(
    "email/password-only signup remains accepted for the current UI",
    signupSchema.safeParse({
      email: "user@example.com",
      password: "secure-pass-123",
    }).success,
  );
  check(
    "caller-supplied identity and tenant ids are stripped",
    (() => {
      const parsed = signupSchema.parse({
      email: "user@example.com",
      password: "secure-pass-123",
      userId: "forged-user",
      organizationId: "forged-org",
      tenantId: "forged-tenant",
      }) as Record<string, unknown>;
      return ["userId", "organizationId", "tenantId"].every(
        (field) => !(field in parsed),
      );
    })(),
  );
  check(
    "anonymous signup is configured for an hourly rate limit",
    RATE_LIMITS.signup.limit === 5 && RATE_LIMITS.signup.windowSeconds === 3600,
  );

  const signupUi = readFileSync(
    path.resolve(process.cwd(), "app/signup/page.tsx"),
    "utf8",
  );
  const signupRoute = readFileSync(
    path.resolve(process.cwd(), "app/api/auth/signup/route.ts"),
    "utf8",
  );
  const supabaseServer = readFileSync(
    path.resolve(process.cwd(), "lib/supabase/server.ts"),
    "utf8",
  );
  check(
    "signup page uses the rate-limited server signup endpoint",
    signupUi.includes('fetch("/api/auth/signup"') &&
      signupUi.includes('credentials: "same-origin"'),
  );
  check(
    "signup page no longer calls Supabase Auth in the browser",
    !signupUi.includes("supabase.auth.signUp") &&
      !signupUi.includes("createSupabaseBrowserClient") &&
      !signupUi.includes("SUPABASE_SERVICE_ROLE_KEY"),
  );
  check(
    "signup page redirects when server reports an established session",
    signupUi.includes("if (!result?.needsEmailConfirmation)") &&
      signupUi.includes('router.replace("/dashboard")'),
  );
  check(
    "signup page shows confirmation flow when no session is returned",
    signupUi.includes("Check your email to confirm your account"),
  );
  check(
    "duplicate provider responses map to the stable signup error contract",
    isDuplicateSignupUser({ identities: [] }) &&
      !isDuplicateSignupUser({ identities: [{ provider: "email" }] }) &&
      signupRoute.includes("isDuplicateSignupUser"),
  );
  check(
    "server signup route separately applies rate limiting and profile provisioning",
    signupRoute.includes('enforceRateLimit("signup"') &&
      signupRoute.includes("waitForProvisionedProfile"),
  );
  check(
    "server signup route preserves provider session through the SSR cookie client",
    signupRoute.includes("needsEmailConfirmation: data.session === null") &&
      signupRoute.includes("createSupabaseServerClient") &&
      supabaseServer.includes("cookieStore.set") &&
      !signupRoute.includes("access_token") &&
      !signupRoute.includes("refresh_token"),
  );
  check(
    "server signup route translates provider rejection to signup error",
    signupRoute.includes("Unable to create an account with the supplied details") &&
      signupRoute.includes('"signup_failed"'),
  );

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
