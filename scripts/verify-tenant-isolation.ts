import {
  count,
  create,
  getById,
  list,
  remove,
  update,
  type Delegate,
} from "../lib/crudService";
import { HttpError } from "../lib/errors";
import { readFileSync } from "node:fs";
import path from "node:path";

type Row = { id: string; userId: string; [key: string]: unknown };
type Call = { method: string; args: Record<string, unknown> };

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

function expectHttpError(
  name: string,
  run: () => unknown,
  status: number,
  code?: string,
): void {
  try {
    run();
    check(name, false);
  } catch (error) {
    check(
      name,
      error instanceof HttpError &&
        error.status === status &&
        (code === undefined || error.code === code),
    );
  }
}

function makeDelegate(initial: Row[]): {
  delegate: Delegate;
  rows: Row[];
  calls: Call[];
} {
  const rows = initial.map((row) => ({ ...row }));
  const calls: Call[] = [];

  function whereOf(args: Record<string, unknown>): Record<string, unknown> {
    const where = args.where;
    return typeof where === "object" && where !== null
      ? (where as Record<string, unknown>)
      : {};
  }

  function matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value);
  }

  const delegate: Delegate = {
    async findMany(args) {
      calls.push({ method: "findMany", args: args as Record<string, unknown> });
      const where = whereOf(args as Record<string, unknown>);
      return rows.filter((row) => matches(row, where));
    },
    async findFirst(args) {
      calls.push({ method: "findFirst", args: args as Record<string, unknown> });
      const where = whereOf(args as Record<string, unknown>);
      return rows.find((row) => matches(row, where)) ?? null;
    },
    async create(args) {
      calls.push({ method: "create", args: args as Record<string, unknown> });
      const data = (args as { data: Row }).data;
      rows.push({ ...data });
      return data;
    },
    async update(args) {
      calls.push({ method: "update", args: args as Record<string, unknown> });
      const id = (args as { where: { id: string } }).where.id;
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error("Missing test row");
      Object.assign(row, (args as { data: Partial<Row> }).data);
      return row;
    },
    async updateMany(args) {
      calls.push({ method: "updateMany", args: args as Record<string, unknown> });
      return { count: 0 };
    },
    async delete(args) {
      calls.push({ method: "delete", args: args as Record<string, unknown> });
      const id = (args as { where: { id: string } }).where.id;
      const index = rows.findIndex((candidate) => candidate.id === id);
      if (index < 0) throw new Error("Missing test row");
      rows.splice(index, 1);
      return {};
    },
    async count(args) {
      calls.push({ method: "count", args: args as Record<string, unknown> });
      const where = whereOf(args as Record<string, unknown>);
      return rows.filter((row) => matches(row, where)).length;
    },
    async deleteMany(args) {
      calls.push({ method: "deleteMany", args: args as Record<string, unknown> });
      return { count: 0 };
    },
  };
  return { delegate, rows, calls };
}

function source(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

async function main(): Promise<void> {
  console.log("Tenant-scoped CRUD helper behavior");
  const { delegate, rows, calls } = makeDelegate([
    { id: "load-own", userId: "tenant-a", loadNumber: "A-1" },
    { id: "load-foreign", userId: "tenant-b", loadNumber: "B-1" },
  ]);

  const own = await getById<Row>(delegate, "tenant-a", "load-own");
  check("authenticated tenant can access own record", own.id === "load-own");
  check(
    "direct foreign record ID is rejected as not found",
    await getById<Row>(delegate, "tenant-a", "load-foreign").then(
      () => false,
      (error: unknown) => error instanceof HttpError && error.status === 404,
    ),
  );

  const listed = await list<Row>(delegate, "tenant-a");
  check("list returns only the caller's records", listed.count === 1 && listed.rows[0]?.id === "load-own");
  check(
    "caller filter cannot override the tenant scope",
    await list<Row>(delegate, "tenant-a", { where: { userId: "tenant-b" } }).then(
      () => false,
      (error: unknown) => error instanceof HttpError && error.status === 403,
    ),
  );

  const created = await create<Row>(delegate, "tenant-a", {
    id: "load-created",
    userId: "tenant-b",
    loadNumber: "A-2",
  });
  check("create cannot assign a record to a foreign tenant", created.userId === "tenant-a");

  const updated = await update<Row>(delegate, "tenant-a", "load-own", {
    loadNumber: "A-1-updated",
    userId: "tenant-b",
  });
  check("attempted re-parenting is stripped from update data", updated.userId === "tenant-a");
  check(
    "foreign record update is rejected without mutation",
    await update<Row>(delegate, "tenant-a", "load-foreign", { loadNumber: "stolen" }).then(
      () => false,
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 404 &&
        rows.find((row) => row.id === "load-foreign")?.loadNumber === "B-1",
    ),
  );
  await remove(delegate, "tenant-a", "load-own");
  check("own record can be removed", !rows.some((row) => row.id === "load-own"));
  const beforeForeignDelete = rows.length;
  await remove(delegate, "tenant-a", "load-foreign").then(
    () => check("foreign record deletion is rejected", false),
    (error: unknown) =>
      check(
        "foreign record deletion is rejected",
        error instanceof HttpError && error.status === 404 && rows.length === beforeForeignDelete,
      ),
  );
  check("count uses the caller's tenant scope", (await count(delegate, "tenant-a")) === 1);
  check(
    "read/update/delete delegate calls include the owner in their filters",
    calls
      .filter((call) => ["findFirst", "findMany", "count"].includes(call.method))
      .every((call) => {
        const args = call.args as { where?: { userId?: unknown } };
        return args.where?.userId === "tenant-a";
      }),
  );

  console.log("\nRepository route ownership contracts");
  const contracts: Array<{ label: string; file: string; patterns: RegExp[] }> = [
    {
      label: "load detail/update resolves record by id and authenticated user",
      file: "app/api/loads/[id]/route.ts",
      patterns: [/where:\s*\{\s*id:\s*params\.id,\s*userId:\s*user\.id\s*\}/],
    },
    {
      label: "load related truck/driver/broker IDs are checked against authenticated user",
      file: "app/api/loads/[id]/route.ts",
      patterns: [/where:\s*\{\s*id:\s*value,\s*userId:\s*user\.id\s*\}/, /invalid_reference/],
    },
    {
      label: "booking writes validate vessel and both ports against authenticated user",
      file: "app/api/bookings/route.ts",
      patterns: [
        /assertOwned\(prisma\.shippingVessel,\s*user\.id,\s*body\.vesselId/,
        /assertOwned\(prisma\.shippingPort,\s*user\.id,\s*body\.portOfLoadingId/,
        /assertOwned\(prisma\.shippingPort,\s*user\.id,\s*body\.portOfDischargeId/,
        /invalid_reference/,
      ],
    },
    {
      label: "shipping booking detail filters by booking ID and authenticated user",
      file: "lib/services/shippingService.ts",
      patterns: [/where:\s*\{\s*id,\s*userId\s*\}/],
    },
    {
      label: "trucking document upload rejects a foreign load ID",
      file: "app/api/documents/upload/route.ts",
      patterns: [/where:\s*\{\s*id:\s*parsed\.loadId,\s*userId:\s*user\.id\s*\}/],
    },
    {
      label: "shipping document upload rejects a foreign booking ID",
      file: "app/api/shipping/documents/upload/route.ts",
      patterns: [/where:\s*\{\s*id:\s*parsed\.bookingId,\s*userId:\s*user\.id\s*\}/],
    },
    {
      label: "trucking document extraction scopes direct ID to authenticated user",
      file: "app/api/documents/[id]/extract/route.ts",
      patterns: [/where:\s*\{\s*id:\s*params\.id,\s*userId:\s*user\.id\s*\}/],
    },
    {
      label: "shipping document extraction scopes direct ID to authenticated user",
      file: "app/api/shipping/documents/[id]/extract/route.ts",
      patterns: [/where:\s*\{\s*id:\s*params\.id,\s*userId:\s*user\.id\s*\}/],
    },
  ];

  for (const contract of contracts) {
    const text = source(contract.file);
    check(contract.label, contract.patterns.every((pattern) => pattern.test(text)));
  }

  const loads = source("app/api/loads/[id]/route.ts");
  check(
    "load route authenticates before querying the requested record",
    loads.indexOf("await requireUser()") >= 0 &&
      loads.indexOf("await requireUser()") < loads.indexOf("prisma.load.findFirst"),
  );

  console.log(`\n${checks - failures}/${checks} tenant-isolation checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Tenant-isolation verification failed:", error);
  process.exitCode = 1;
});
