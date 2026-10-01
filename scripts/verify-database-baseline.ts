import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaPath = path.join(root, "prisma", "schema.prisma");
const migrationsPath = path.join(root, "prisma", "migrations");
const rlsPath = path.join(root, "supabase", "rls-policies.sql");

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

function tableOf(modelName: string, body: string): string {
  const mapped = body.match(/@@map\("([^"]+)"\)/);
  return mapped?.[1] ?? modelName;
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function main(): void {
  console.log("DATABASE BASELINE: repository state only; no database connection is made.");
  const schema = readFileSync(schemaPath, "utf8");
  const rls = readFileSync(rlsPath, "utf8");

  const migrationDirs = readdirSync(migrationsPath)
    .filter((entry) => statSync(path.join(migrationsPath, entry)).isDirectory())
    .sort();
  check("at least one migration directory exists", migrationDirs.length > 0);
  check(
    "migration directory names are chronologically sortable",
    migrationDirs.every((entry) => /^\d{14}_[a-z0-9_]+$/.test(entry)),
  );
  const migrationSql: Array<{ file: string; text: string }> = [];
  for (const directory of migrationDirs) {
    const file = path.join(migrationsPath, directory, "migration.sql");
    try {
      migrationSql.push({ file, text: readFileSync(file, "utf8") });
    } catch {
      check(`${directory} contains migration.sql`, false);
    }
  }
  check("every migration directory contains migration.sql", migrationSql.length === migrationDirs.length);

  const models: Array<{ name: string; table: string; body: string }> = [];
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const name = match[1];
    const body = match[2];
    if (!name || !body) continue;
    models.push({ name, table: tableOf(name, body), body });
  }
  check("Prisma schema declares domain/operational models", models.length >= 20);

  const allMigrationText = migrationSql.map((migration) => migration.text).join("\n");
  const enumNames = new Set(
    [...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined),
  );
  for (const model of models) {
    const table = sqlIdentifier(model.table);
    const hasCreate = new RegExp(
      `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "i",
    ).test(allMigrationText);
    check(`model ${model.name} maps to a table created by a checked-in migration`, hasCreate);

    const createBlock = new RegExp(
      `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(([\\s\\S]*?)\\n\\);`,
      "i",
    ).exec(allMigrationText)?.[1] ?? "";
    const scalarFields = new Set([
      "String",
      "Int",
      "BigInt",
      "Float",
      "Boolean",
      "DateTime",
      "Decimal",
      "Json",
      "Bytes",
      ...enumNames,
    ]);
    const fieldLines = model.body.matchAll(/^\s*(\w+)\s+([\w]+)(?:\?)?(?:\[\])?(?:\s+.*)?$/gm);
    for (const fieldMatch of fieldLines) {
      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      if (!fieldName || !fieldType || !scalarFields.has(fieldType)) continue;
      const line = fieldMatch[0];
      const mappedColumn = line.match(/@map\("([^"]+)"\)/)?.[1] ?? fieldName;
      const column = sqlIdentifier(mappedColumn);
      const inCreateTable = createBlock.includes(column);
      const addedLater = new RegExp(
        `ALTER\\s+TABLE\\s+${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+ADD\\s+COLUMN\\s+${column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "i",
      ).test(allMigrationText);
      check(
        `model ${model.name}.${fieldName} has a checked-in migration column`,
        inCreateTable || addedLater,
      );
    }
  }

  const tenantModels = models.filter((model) => /^\s*userId\s+String\b/m.test(model.body));
  const tablesWithoutTenantIndexes = tenantModels.filter(
    (model) => !/@@(?:index|unique)\(\[userId(?:,|\])/m.test(model.body),
  );
  check(
    "every userId-owned model has a userId-leading index or unique index",
    tablesWithoutTenantIndexes.length === 0,
  );
  for (const model of tablesWithoutTenantIndexes) {
    console.error(`         missing userId-leading index: ${model.name} (${model.table})`);
  }
  for (const model of tenantModels) {
    const table = sqlIdentifier(model.table);
    const hasTenantIndex = new RegExp(
      `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+[^\\n]+\\s+ON\\s+${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(\\s*"user_id"`,
      "i",
    ).test(allMigrationText);
    check(
      `checked-in migrations include a user_id-leading index for ${model.table}`,
      hasTenantIndex,
    );
  }

  const tenantTables = tenantModels.map((model) => model.table);
  const policySection = rls.split("-- subscriptions:")[0] ?? rls;
  const listStart = policySection.indexOf("tables TEXT[]");
  const policyLoop = listStart >= 0 ? policySection.slice(listStart) : "";
  for (const table of tenantTables) {
    const accountedFor =
      table === "subscriptions"
        ? rls.includes("subscriptions_select_own")
        : table === "stripe_events"
          ? rls.includes("stripe_events") && rls.includes("policy-free")
          : new RegExp(`'${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`).test(policyLoop);
    check(`RLS repository script accounts for tenant table ${table}`, accountedFor);
  }
  check(
    "RLS repository script contains explicit live verification queries",
    rls.includes("Verification — every one") &&
      rls.includes("rowsecurity = FALSE") &&
      rls.includes("Cross-tenant read attempt"),
  );

  const requiredForeignKeys = [
    "trucks_user_id_fkey",
    "loads_user_id_fkey",
    "loads_broker_id_fkey",
    "loads_driver_id_fkey",
    "loads_truck_id_fkey",
    "documents_load_id_fkey",
    "invoices_load_id_fkey",
    "shipping_bookings_user_id_fkey",
    "shipping_bookings_vesselId_fkey",
    "shipping_bookings_portOfLoadingId_fkey",
    "shipping_bookings_portOfDischargeId_fkey",
    "shipping_containers_bookingId_fkey",
    "shipping_documents_bookingId_fkey",
  ];
  for (const constraint of requiredForeignKeys) {
    check(
      `important foreign key ${constraint} is present in a checked-in migration`,
      migrationSql.some((migration) => migration.text.includes(constraint)),
    );
  }

  console.log(
    `\n${checks - failures}/${checks} repository database-baseline checks passed.`,
  );
  console.log(
    "LIVE SUPABASE STATE: UNVERIFIED. This script reads repository files only; it does not connect to PostgreSQL or execute SQL.",
  );
  if (failures > 0) process.exitCode = 1;
}

main();
