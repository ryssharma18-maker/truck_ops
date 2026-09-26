import { prisma } from "@/lib/prisma";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import * as crud from "@/lib/crudService";
import { z } from "zod";
import { HttpError } from "@/lib/errors";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const truckStatus = z.enum(["active", "inactive", "maintenance"]);

const createTruckSchema = z.object({
  truckNumber: z.string().min(1, "Truck number is required").max(32),
  vin: z.string().max(17).optional(),
  make: z.string().max(64).optional(),
  model: z.string().max(64).optional(),
  year: z.coerce.number().int().min(1980).max(2100).optional(),
  licensePlate: z.string().max(16).optional(),
  status: truckStatus.default("active"),
});

/** GET /api/trucks — trucks belonging to the caller, newest first. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  if (status && !truckStatus.safeParse(status).success) {
    throw new HttpError(400, `Unknown truck status "${status}"`, "invalid_status");
  }

  const include = {
    drivers: true,
    _count: { select: { loads: true } },
  } as const;

  const { rows, count } = await crud.list<Prisma.TruckGetPayload<{ include: typeof include }>>(
    prisma.truck,
    user.id,
    { where: status ? { status } : {}, orderBy: { createdAt: "desc" }, include },
  );

  return ok({ trucks: rows, count });
});

/** POST /api/trucks — create a truck for the caller. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  const body = createTruckSchema.parse(await req.json());

  const existing = await prisma.truck.count({
    where: { userId: user.id, truckNumber: body.truckNumber },
  });
  if (existing) {
    throw new HttpError(409, `Truck ${body.truckNumber} already exists`, "duplicate");
  }

  const truck = await crud.create(prisma.truck, user.id, {
    truckNumber: body.truckNumber,
    vin: body.vin ?? null,
    make: body.make ?? null,
    model: body.model ?? null,
    year: body.year ?? null,
    licensePlate: body.licensePlate ?? null,
    status: body.status,
  });

  return ok(truck, 201);
});
