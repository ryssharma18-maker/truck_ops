export interface SeedSafetyEnvironment {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  APP_ENV?: string;
  DEPLOYMENT_ENV?: string;
  SEED_TARGET_ENVIRONMENT?: string;
  DATABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SEED_EMAIL?: string;
  SEED_CONFIRM_DESTRUCTIVE?: string;
}

export interface SeedTargetSelection {
  email: string;
  environment: "development" | "preview";
}

const NON_PRODUCTION_ENVIRONMENTS = new Set(["development", "preview"]);
const ALLOWED_NON_PRODUCTION_SUPABASE_PROJECT_REFS = new Set<string>();

function isProductionEnvironment(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "prod" || normalized === "production";
}

export function destructiveConfirmationPhrase(email: string): string {
  return `DELETE ALL DATA FOR ${email.trim().toLowerCase()}`;
}

function supabaseProjectRefFromUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("A Supabase URL is required to verify the seed database target.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The Supabase URL cannot be verified as an approved seed target.");
  }
  const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname);
  const projectRef = match?.[1];
  if (url.protocol !== "https:" || !projectRef) {
    throw new Error("The Supabase URL cannot be verified as an approved seed target.");
  }
  return projectRef.toLowerCase();
}

function databaseProjectRefFromUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("DATABASE_URL is required to verify the seed database target.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL cannot be verified as an approved seed target.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL cannot be verified as an approved seed target.");
  }

  const directHostMatch = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(
    url.hostname,
  );
  const directProjectRef = directHostMatch?.[1];
  if (directProjectRef) return directProjectRef.toLowerCase();

  if (/^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname)) {
    let username: string;
    try {
      username = decodeURIComponent(url.username);
    } catch {
      throw new Error("DATABASE_URL cannot be verified as an approved seed target.");
    }
    const poolerUserMatch = /^postgres\.([a-z0-9-]+)$/i.exec(username);
    const poolerProjectRef = poolerUserMatch?.[1];
    if (poolerProjectRef) return poolerProjectRef.toLowerCase();
  }

  throw new Error("DATABASE_URL cannot be verified as an approved seed target.");
}

export function assertApprovedSeedDatabaseTarget(
  environment: SeedSafetyEnvironment,
): string {
  const databaseProjectRef = databaseProjectRefFromUrl(environment.DATABASE_URL);
  const supabaseProjectRef = supabaseProjectRefFromUrl(
    environment.NEXT_PUBLIC_SUPABASE_URL,
  );
  if (
    databaseProjectRef !== supabaseProjectRef ||
    !ALLOWED_NON_PRODUCTION_SUPABASE_PROJECT_REFS.has(databaseProjectRef)
  ) {
    throw new Error(
      "The configured database and Supabase project must match an approved non-production seed target.",
    );
  }
  return databaseProjectRef;
}

export function resolveSeedTargetSelection(
  environment: SeedSafetyEnvironment,
): SeedTargetSelection {
  const productionMarkers = [
    environment.NODE_ENV,
    environment.VERCEL_ENV,
    environment.APP_ENV,
    environment.DEPLOYMENT_ENV,
    environment.SEED_TARGET_ENVIRONMENT,
  ];
  if (
    productionMarkers.some(
      isProductionEnvironment,
    )
  ) {
    throw new Error("Demo seeding is forbidden in production.");
  }

  const targetEnvironment = environment.SEED_TARGET_ENVIRONMENT
    ?.trim()
    .toLowerCase();
  if (
    !targetEnvironment ||
    !NON_PRODUCTION_ENVIRONMENTS.has(targetEnvironment)
  ) {
    throw new Error(
      "Set SEED_TARGET_ENVIRONMENT to development or preview explicitly.",
    );
  }

  const email = environment.SEED_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error(
      "Set SEED_EMAIL explicitly; the seed never selects a default account.",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("SEED_EMAIL must be a valid email address.");
  }

  const expectedConfirmation = destructiveConfirmationPhrase(email);
  if (environment.SEED_CONFIRM_DESTRUCTIVE !== expectedConfirmation) {
    throw new Error(
      `Set SEED_CONFIRM_DESTRUCTIVE exactly to "${expectedConfirmation}" to authorize replacing this account's seed data.`,
    );
  }

  return { email, environment: targetEnvironment as "development" | "preview" };
}

export interface ConfirmedSeedTarget {
  id: string;
  email: string;
}

export function confirmResolvedSeedTarget(
  environment: SeedSafetyEnvironment,
  target: ConfirmedSeedTarget | null,
): ConfirmedSeedTarget {
  const selection = resolveSeedTargetSelection(environment);
  if (!target) {
    throw new Error(
      `No existing application profile for ${selection.email}. Create/sign in the non-production demo account before seeding; the seed will not create or delete auth/profile accounts.`,
    );
  }
  if (target.email.trim().toLowerCase() !== selection.email) {
    throw new Error("Resolved seed profile does not match the selected email.");
  }
  if (!target.id) {
    throw new Error("Resolved seed profile has no user ID.");
  }
  return { id: target.id, email: selection.email };
}

export function shouldResetDemoPassword(
  target: ConfirmedSeedTarget,
  resetRequested: boolean,
): boolean {
  if (!resetRequested) return false;
  if (target.email !== "demo@truckops.ai") {
    throw new Error(
      "Password reset is permitted only for the explicitly selected demo@truckops.ai account.",
    );
  }
  return true;
}

export function parseDemoPasswordResetRequest(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("SEED_RESET_DEMO_PASSWORD must be exactly true or false.");
}
