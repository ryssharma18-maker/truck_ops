import { readFileSync } from "node:fs";
import path from "node:path";
import { errorResponse } from "../lib/auth";
import { HttpError } from "../lib/errors";
import { signupSchema } from "../lib/validation";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean): void {
  checks++;
  if (condition) console.log(`  [ok]   ${name}`);
  else {
    failures++;
    console.error(`  [FAIL] ${name}`);
  }
}

function source(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

async function main(): Promise<void> {
  console.log("Shared API error response contracts");
  const unauthorized = errorResponse(
    new HttpError(401, "Not authenticated", "unauthenticated"),
  );
  const unauthorizedBody = await unauthorized.json();
  check(
    "unauthenticated errors return 401 and the standard JSON envelope",
    unauthorized.status === 401 &&
      unauthorizedBody.error === "Not authenticated" &&
      unauthorizedBody.code === "unauthenticated",
  );

  const forbidden = errorResponse(new HttpError(403, "Forbidden", "forbidden"));
  const forbiddenBody = await forbidden.json();
  check(
    "authorization errors retain 403 and their code",
    forbidden.status === 403 && forbiddenBody.code === "forbidden",
  );

  const validation = errorResponse({
    issues: [{ path: ["status"], message: "Invalid enum value" }],
  });
  const validationBody = await validation.json();
  check(
    "validation failures return 422 with issues",
    validation.status === 422 &&
      validationBody.code === "validation_error" &&
      Array.isArray(validationBody.issues),
  );

  const duplicate = errorResponse({ code: "P2002" });
  const duplicateBody = await duplicate.json();
  check(
    "Prisma unique conflicts return 409",
    duplicate.status === 409 && duplicateBody.code === "duplicate",
  );

  console.log("\nCritical API route source contracts");
  const routes = [
    {
      name: "load list requires an authenticated user and returns loads/count",
      file: "app/api/loads/route.ts",
      patterns: [/await requireUser\(\)/, /crud\.list/, /ok\(\{\s*loads:\s*rows,\s*count\s*\}\)/],
    },
    {
      name: "load patch validates input and scopes the requested load",
      file: "app/api/loads/[id]/route.ts",
      patterns: [/patchLoadSchema\.parse/, /where:\s*\{\s*id:\s*params\.id,\s*userId:\s*user\.id\s*\}/, /return ok\(updated\)/],
    },
    {
      name: "booking list requires auth and returns bookings/count",
      file: "app/api/bookings/route.ts",
      patterns: [/await requireUser\(\)/, /crud\.list/, /ok\(\{\s*bookings:\s*rows,\s*count\s*\}\)/],
    },
    {
      name: "shipping booking detail maps a non-owned booking to the service not-found path",
      file: "lib/services/shippingService.ts",
      patterns: [/where:\s*\{\s*id,\s*userId\s*\}/, /if \(!b\) throw new HttpError\(404/],
    },
    {
      name: "trucking document upload requires auth, validates metadata and returns 201",
      file: "app/api/documents/upload/route.ts",
      patterns: [/await requireUser\(\)/, /meta\.parse/, /ok\(doc,\s*201\)/],
    },
    {
      name: "shipping document upload API requires auth, validates metadata and returns 201",
      file: "app/api/shipping/documents/upload/route.ts",
      patterns: [/await requireUser\(\)/, /meta\.parse/, /ok\(doc,\s*201\)/],
    },
    {
      name: "document extraction APIs require auth and scope document IDs",
      file: "app/api/documents/[id]/extract/route.ts",
      patterns: [/await requireUser\(\)/, /where:\s*\{\s*id:\s*params\.id,\s*userId:\s*user\.id\s*\}/, /return ok\(/],
    },
    {
      name: "shipping document extraction API requires auth and scopes document IDs",
      file: "app/api/shipping/documents/[id]/extract/route.ts",
      patterns: [/await requireUser\(\)/, /where:\s*\{\s*id:\s*params\.id,\s*userId:\s*user\.id\s*\}/, /return ok\(/],
    },
    {
      name: "protected profile API requires auth",
      file: "app/api/user/profile/route.ts",
      patterns: [/await requireUser\(\)/, /publicProfile/],
    },
  ];

  for (const route of routes) {
    const text = source(route.file);
    check(route.name, route.patterns.every((pattern) => pattern.test(text)));
  }

  console.log("\nAuthentication boundary contracts");
  const middleware = source("middleware.ts");
  const auth = source("lib/auth.ts");
  check(
    "middleware returns JSON 401 for unauthenticated protected APIs",
    /if \(!user\)[\s\S]{0,300}pathname\.startsWith\("\/api\/"\)[\s\S]{0,150}status:\s*401/.test(
      middleware,
    ),
  );
  check(
    "requireUser requires Supabase configuration and a resolved account profile",
    auth.includes("auth_not_configured") &&
      auth.includes("supabase.auth.getUser()") &&
      auth.includes("profile_missing"),
  );
  check(
    "signup contract rejects invalid input before any external call",
    !signupSchema.safeParse({
      email: "not-valid",
      password: "short",
      fullName: "",
      companyName: "",
    }).success,
  );

  console.log(`\n${checks - failures}/${checks} API contract checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("API-contract verification failed:", error);
  process.exitCode = 1;
});
