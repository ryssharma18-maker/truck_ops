import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import * as crud from "@/lib/crudService";
import { HttpError } from "@/lib/errors";
import { assertCanCreate } from "@/lib/planLimits";

export const dynamic = "force-dynamic";

const driverStatus = z.enum(["active", "inactive"]);

const createDriverSchema = z.object({
  fullName: z.string().min(1, "Driver name is required").max(120),
  email: z.string().email().optional(),
  phone: z.string().max(32).optional(),
  licenseNumber: z.string().max(32).optional(),
  licenseExpiry: z.coerce.date().optional(),
  assignedTruckId: z.string().uuid().optional(),
  status: driverStatus.default("active"),
});

/** GET /api/drivers — drivers belonging to the caller, newest first. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  if (status && !driverStatus.safeParse(status).success) {
    throw new HttpError(400, `Unknown driver status "${status}"`, "invalid_status");
  }

  const include = { assignedTruck: true, _count: { select: { loads: true } } } as const;

  const { rows, count } = await crud.list<Prisma.DriverGetPayload<{ include: typeof include }>>(
    prisma.driver,
    user.id,
    { where: status ? { status } : {}, orderBy: { createdAt: "desc" }, include },
  );

  return ok({ drivers: rows, count });
});

/** POST /api/drivers — create a driver for the caller. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  // A driver is a person you will need a truck for, so it counts against the
  // same ceiling as the fleet.
  await assertCanCreate(user, "driver");
  const body = createDriverSchema.parse(await req.json());

  if (body.assignedTruckId) {
    const truck = await prisma.truck.count({
      where: { id: body.assignedTruckId, userId: user.id },
    });
    if (!truck) throw new HttpError(400, "assignedTruckId is not one of your trucks", "invalid_truck");
  }

  const driver = await crud.create(prisma.driver, user.id, {
    fullName: body.fullName,
    email: body.email ?? null,
    phone: body.phone ?? null,
    licenseNumber: body.licenseNumber ?? null,
    licenseExpiry: body.licenseExpiry ?? null,
    assignedTruckId: body.assignedTruckId ?? null,
    status: body.status,
  });

  return ok(driver, 201);
});
