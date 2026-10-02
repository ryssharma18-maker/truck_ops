import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertApprovedSeedDatabaseTarget,
  confirmResolvedSeedTarget,
  destructiveConfirmationPhrase,
  parseDemoPasswordResetRequest,
  resolveSeedTargetSelection,
  shouldResetDemoPassword,
} from "../lib/seedSafety";

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

function rejects(action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

function source(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function position(text: string, fragment: string): number {
  return text.indexOf(fragment);
}

function main(): void {
  console.log("Seed invocation safety policy");
  const productionProjectRef = "papddtmsiajajcvdrody";
  const productionDatabaseTarget = {
    DATABASE_URL: `postgresql://postgres.${productionProjectRef}@aws-0-test.pooler.supabase.com:5432/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${productionProjectRef}.supabase.co`,
  };
  const seedSelectionEnvironment = {
    NODE_ENV: "development",
    SEED_TARGET_ENVIRONMENT: "development",
    SEED_EMAIL: "demo@truckops.ai",
    SEED_CONFIRM_DESTRUCTIVE:
      destructiveConfirmationPhrase("demo@truckops.ai"),
  };
  check(
    "default invocation refuses without explicit target/environment/confirmation",
    rejects(() => resolveSeedTargetSelection({})),
  );
  check(
    "missing destructive confirmation refuses",
    rejects(() =>
      resolveSeedTargetSelection({
        SEED_TARGET_ENVIRONMENT: "development",
        SEED_EMAIL: "demo@truckops.ai",
      }),
    ),
  );
  check(
    "missing SEED_EMAIL refuses",
    rejects(() =>
      resolveSeedTargetSelection({
        SEED_TARGET_ENVIRONMENT: "development",
        SEED_CONFIRM_DESTRUCTIVE:
          destructiveConfirmationPhrase("demo@truckops.ai"),
      }),
    ),
  );
  check(
    "production NODE_ENV is unconditionally rejected",
    rejects(() =>
      resolveSeedTargetSelection({
        NODE_ENV: "production",
        SEED_TARGET_ENVIRONMENT: "development",
        SEED_EMAIL: "demo@truckops.ai",
        SEED_CONFIRM_DESTRUCTIVE:
          destructiveConfirmationPhrase("demo@truckops.ai"),
      }),
    ),
  );
  check(
    "production Vercel environment is unconditionally rejected",
    rejects(() =>
      resolveSeedTargetSelection({
        VERCEL_ENV: "production",
        SEED_TARGET_ENVIRONMENT: "preview",
        SEED_EMAIL: "demo@truckops.ai",
        SEED_CONFIRM_DESTRUCTIVE:
          destructiveConfirmationPhrase("demo@truckops.ai"),
      }),
    ),
  );
  check(
    "production target declaration cannot be overridden by confirmation",
    rejects(() =>
      resolveSeedTargetSelection({
        NODE_ENV: "development",
        SEED_TARGET_ENVIRONMENT: "production",
        SEED_EMAIL: "demo@truckops.ai",
        SEED_CONFIRM_DESTRUCTIVE:
          destructiveConfirmationPhrase("demo@truckops.ai"),
      }),
    ),
  );
  check(
    "ambiguous non-production target environment refuses",
    rejects(() =>
      resolveSeedTargetSelection({
        SEED_TARGET_ENVIRONMENT: "staging-ish",
        SEED_EMAIL: "demo@truckops.ai",
        SEED_CONFIRM_DESTRUCTIVE:
          destructiveConfirmationPhrase("demo@truckops.ai"),
      }),
    ),
  );
  check(
    "development environment with production database target is rejected",
    rejects(() =>
      (() => {
        const environment = {
          ...seedSelectionEnvironment,
          ...productionDatabaseTarget,
        };
        resolveSeedTargetSelection(environment);
        assertApprovedSeedDatabaseTarget(environment);
      })(),
    ),
  );
  check(
    "preview environment with production database target is rejected",
    rejects(() =>
      (() => {
        const environment = {
          ...seedSelectionEnvironment,
          ...productionDatabaseTarget,
          SEED_TARGET_ENVIRONMENT: "preview",
        };
        resolveSeedTargetSelection(environment);
        assertApprovedSeedDatabaseTarget(environment);
      })(),
    ),
  );
  check(
    "unknown or unverifiable database target is rejected",
    rejects(() =>
      assertApprovedSeedDatabaseTarget({
        DATABASE_URL: "postgresql://user@localhost:5432/postgres",
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      }),
    ),
  );
  check(
    "confirmed production Supabase project is explicitly rejected",
    rejects(() =>
      assertApprovedSeedDatabaseTarget(productionDatabaseTarget),
    ),
  );
  const approvedProductionMarkedEnvironment = {
    ...seedSelectionEnvironment,
    ...productionDatabaseTarget,
    NODE_ENV: "production",
    ALLOW_PRODUCTION: "true",
  };
  check(
    "production environment is rejected even with the production DB target and an apparent override",
    rejects(() =>
      resolveSeedTargetSelection(approvedProductionMarkedEnvironment),
    ),
  );
  check(
    "unapproved or mismatched target confirmation refuses",
    rejects(() =>
      resolveSeedTargetSelection({
        SEED_TARGET_ENVIRONMENT: "development",
        SEED_EMAIL: "customer@example.com",
        SEED_CONFIRM_DESTRUCTIVE:
          destructiveConfirmationPhrase("demo@truckops.ai"),
      }),
    ),
  );
  const approvedSelection = resolveSeedTargetSelection({
    NODE_ENV: "development",
    SEED_TARGET_ENVIRONMENT: "development",
    SEED_EMAIL: " Demo@TruckOps.ai ",
    SEED_CONFIRM_DESTRUCTIVE:
      destructiveConfirmationPhrase("demo@truckops.ai"),
  });
  const approvedEnvironment = {
    ...seedSelectionEnvironment,
    SEED_EMAIL: " Demo@TruckOps.ai ",
    SEED_CONFIRM_DESTRUCTIVE: destructiveConfirmationPhrase("demo@truckops.ai"),
  };
  check(
    "explicit email and environment selection passes the policy stage",
    approvedSelection.email === "demo@truckops.ai" &&
      approvedSelection.environment === "development",
  );
  check(
    "target profile must exist before it can be confirmed",
    rejects(() =>
      confirmResolvedSeedTarget(approvedEnvironment, null),
    ),
  );
  check(
    "resolved profile must match the explicitly selected email",
    rejects(() =>
      confirmResolvedSeedTarget(approvedEnvironment, {
        id: "user-1",
        email: "other@example.com",
      }),
    ),
  );
  check(
    "target confirmation independently rejects production environments",
    rejects(() =>
      confirmResolvedSeedTarget(
        {
          ...approvedEnvironment,
          NODE_ENV: "production",
        },
        { id: "user-1", email: "demo@truckops.ai" },
      ),
    ),
  );
  check(
    "target confirmation independently requires matching destructive confirmation",
    rejects(() =>
      confirmResolvedSeedTarget(
        {
          ...approvedEnvironment,
          SEED_CONFIRM_DESTRUCTIVE: "DELETE ALL DATA FOR other@example.com",
        },
        { id: "user-1", email: "demo@truckops.ai" },
      ),
    ),
  );
  const confirmedTarget = confirmResolvedSeedTarget(approvedEnvironment, {
    id: "resolved-user-id",
    email: "DEMO@TRUCKOPS.AI",
  });
  check(
    "valid selection resolves to a concrete confirmed user ID",
    confirmedTarget.id === "resolved-user-id" &&
      confirmedTarget.email === "demo@truckops.ai",
  );
  check(
    "password reset is denied for any non-demo account",
    rejects(() =>
      shouldResetDemoPassword(
        { id: "user-2", email: "customer@example.com" },
        true,
      ),
    ),
  );
  check(
    "demo password reset requires an explicit true flag",
    !parseDemoPasswordResetRequest(undefined) &&
      !parseDemoPasswordResetRequest("false") &&
      parseDemoPasswordResetRequest("true") &&
      rejects(() => parseDemoPasswordResetRequest("yes")),
  );

  console.log("\nSeed mutation ordering and target scope");
  const seed = source("prisma/seed.ts");
  const mainStart = position(seed, "async function main()");
  const mainBody = seed.slice(mainStart);
  const selectionPosition = position(
    mainBody,
    "resolveSeedTargetSelection(process.env)",
  );
  const databaseTargetPosition = position(
    mainBody,
    "assertApprovedSeedDatabaseTarget(process.env)",
  );
  const profileLookupPosition = position(
    mainBody,
    "prisma.user.findUnique({",
  );
  const targetConfirmationPosition = position(
    mainBody,
    "confirmResolvedSeedTarget(process.env, selectedProfile)",
  );
  const authVerificationPosition = position(
    mainBody,
    "prepareDemoPasswordReset(target)",
  );
  const countsPosition = position(mainBody, "getPlannedDeleteCounts(target.id)");
  const preflightPosition = position(
    mainBody,
    "printSeedPreflight(target, selection.environment, counts)",
  );
  const deletePosition = position(mainBody, "wipeDemoData(target.id)");
  const adminMutationPosition = position(
    mainBody,
    "if (performPasswordReset) await performPasswordReset()",
  );
  const profileMutationPosition = position(
    mainBody,
    "prisma.user.update({",
  );
  const truckingMutationPosition = position(mainBody, "seedTrucking(target.id)");
  const shippingMutationPosition = position(mainBody, "seedShipping(target.id)");
  const notificationMutationPosition = position(
    mainBody,
    "prisma.notification.createMany({",
  );
  check(
    "policy validation, profile resolution, Auth verification, and preflight precede every mutation",
    selectionPosition >= 0 &&
      selectionPosition < databaseTargetPosition &&
      databaseTargetPosition < profileLookupPosition &&
      profileLookupPosition < targetConfirmationPosition &&
      targetConfirmationPosition < authVerificationPosition &&
      authVerificationPosition < countsPosition &&
      countsPosition < preflightPosition &&
      preflightPosition < deletePosition,
  );
  check(
    "password reset itself and all seed mutations follow the destructive wipe",
    deletePosition < adminMutationPosition &&
      adminMutationPosition < profileMutationPosition &&
      profileMutationPosition < truckingMutationPosition &&
      truckingMutationPosition < shippingMutationPosition &&
      shippingMutationPosition < notificationMutationPosition,
  );
  check(
    "seed does not create or delete auth users or delete profile rows",
    !seed.includes("admin.createUser") &&
      !seed.includes("prisma.user.delete(") &&
      !seed.includes("prisma.user.deleteMany("),
  );
  const deleteCalls = [...seed.matchAll(/\.deleteMany\(\{([\s\S]*?)\}\)/g)];
  check(
    "every deleteMany call is scoped by the confirmed userId",
    deleteCalls.length === 18 &&
      deleteCalls.every((match) => /\bwhere:\s*\{\s*userId\s*\}/.test(match[1] ?? "")) &&
      position(seed, "async function wipeDemoData(userId: string)") >= 0,
  );
  check(
    "all scoped deletion calls are inside the target-parameterized wipe function",
    deleteCalls.every((match) => {
      const start = match.index ?? -1;
      const wipeStart = position(seed, "async function wipeDemoData(userId: string)");
      const wipeEnd = position(seed, "async function seedTrucking",);
      return start >= wipeStart && start < wipeEnd;
    }),
  );
  check(
    "Supabase Auth target verification is pre-wipe and only password update is deferred",
    seed.includes("admin.auth.admin.getUserById(target.id)") &&
      /admin\.auth\.admin\.updateUserById\(\s*target\.id,/.test(seed) &&
      seed.includes("return async () => {") &&
      authVerificationPosition < deletePosition,
  );
  check(
    "preflight prints resolved target, scoped counts, reset plan, and no-backup warning",
    seed.includes("DESTRUCTIVE SEED PREFLIGHT") &&
      seed.includes("planned row deletions") &&
      seed.includes("No backup is created by this command"),
  );

  console.log(`\n${checks - failures}/${checks} seed-safety checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error("Seed-safety verification failed:", error);
  process.exitCode = 1;
}
