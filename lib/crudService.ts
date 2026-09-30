import { HttpError } from "@/lib/errors";

/**
 * Tenant-scoped CRUD helpers.
 *
 * Prisma connects over the direct Postgres connection as the database owner,
 * which BYPASSES Row Level Security. RLS is only a second line of defence for
 * clients using the Supabase anon key — for server code, `where: { userId }` in
 * the query IS the tenant boundary. Every helper here takes `userId` as a
 * required argument and folds it into the `where` clause, so a route handler
 * cannot accidentally leak another carrier's rows.
 *
 * See the header comment in prisma/schema.prisma.
 */

/** Structural view of a Prisma model delegate — enough for the helpers below. */
export interface Delegate {
  findMany(args: object): Promise<unknown>;
  findFirst(args: object): Promise<unknown>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<unknown>;
  updateMany(args: object): Promise<unknown>;
  delete(args: object): Promise<unknown>;
  count(args: object): Promise<number>;
  deleteMany(args: object): Promise<unknown>;
}

export interface ListArgs {
  orderBy?: object;
  take?: number;
  skip?: number;
  include?: object;
  select?: object;
  cursor?: object;
  where?: Record<string, unknown>;
}

export interface ListResult<T> {
  rows: T[];
  count: number;
}

/** Merge caller filters with the mandatory tenant filter. */
function scoped(
  userId: string,
  where: Record<string, unknown> = {},
): Record<string, unknown> {
  if (where.userId !== undefined && where.userId !== userId) {
    throw new HttpError(403, "Cannot access another tenant's records", "forbidden");
  }
  return { ...where, userId };
}

export async function list<T>(
  delegate: Delegate,
  userId: string,
  args: ListArgs = {},
): Promise<ListResult<T>> {
  const { where, ...rest } = args;
  const where_ = scoped(userId, where);
  const [rows, count] = await Promise.all([
    delegate.findMany({ where: where_, ...rest }),
    delegate.count({ where: where_ }),
  ]);
  return { rows: rows as T[], count };
}

export async function getById<T>(
  delegate: Delegate,
  userId: string,
  id: string,
  args: Omit<ListArgs, "where" | "orderBy"> = {},
): Promise<T> {
  const row = await delegate.findFirst({ where: { id, userId }, ...args });
  if (!row) throw new HttpError(404, "Not found", "not_found");
  return row as T;
}

/** Fetch without throwing — for optional relations. */
export async function findById<T>(
  delegate: Delegate,
  userId: string,
  id: string,
  args: Omit<ListArgs, "where" | "orderBy"> = {},
): Promise<T | null> {
  const row = await delegate.findFirst({ where: { id, userId }, ...args });
  return (row as T | null) ?? null;
}

export async function create<T>(
  delegate: Delegate,
  userId: string,
  data: Record<string, unknown>,
  args: { select?: object; include?: object } = {},
): Promise<T> {
  return (await delegate.create({ data: { ...data, userId }, ...args })) as T;
}

/**
 * Update by id, scoped to the tenant. Throws 404 when the row belongs to
 * someone else, so callers cannot probe for other tenants' ids.
 *
 * `data` has any `userId` stripped rather than the field simply being
 * overwritten. `create` and `list` append `userId` last so a caller's `data`
 * cannot win, but an update is a merge, and a caller who passed
 * `{ userId: someoneElse }` would otherwise re-parent the row into another
 * tenant. The 404 above proves the row was the caller's to begin with; this
 * stops it from ceasing to be the caller's afterwards.
 */
export async function update<T>(
  delegate: Delegate,
  userId: string,
  id: string,
  data: Record<string, unknown>,
  args: { select?: object; include?: object } = {},
): Promise<T> {
  const existing = await delegate.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw new HttpError(404, "Not found", "not_found");

  const { userId: _ignored, ...safeData } = data;
  return (await delegate.update({ where: { id }, data: safeData, ...args })) as T;
}

export async function remove(
  delegate: Delegate,
  userId: string,
  id: string,
): Promise<void> {
  const existing = await delegate.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw new HttpError(404, "Not found", "not_found");
  await delegate.delete({ where: { id } });
}

export async function count(
  delegate: Delegate,
  userId: string,
  where: Record<string, unknown> = {},
): Promise<number> {
  return delegate.count({ where: scoped(userId, where) });
}

/**
 * `prisma.$transaction` over a set of tenant-scoped writes. Every callback
 * receives the tx client so a multi-write change is all-or-nothing.
 */
export async function transaction<T>(
  tx: {
    $transaction<T>(fn: (client: never) => Promise<T>): Promise<T>;
  },
  fn: (client: never) => Promise<T>,
): Promise<T> {
  return tx.$transaction(fn);
}
