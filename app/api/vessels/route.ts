import type { Prisma, ShippingVesselStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import * as crud from "@/lib/crudService";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const vesselStatus = z.enum(["active", "in_port", "at_sea", "maintenance"]);

const createVesselSchema = z.object({
  name: z.string().min(1, "Vessel name is required").max(120),
  imoNumber: z
    .string()
    .regex(/^\d{7}$/, "IMO number must be exactly 7 digits"),
  flag: z.string().max(64).optional(),
  vesselType: z.string().max(64).optional(),
  capacityTeu: z.coerce.number().int().min(0).optional(),
  deadweightTons: z.coerce.number().min(0).optional(),
  status: vesselStatus.default("active"),
});

/** GET /api/vessels — vessels in the caller's fleet. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const status = new URL(req.url).searchParams.get("status");

  if (status && !vesselStatus.safeParse(status).success) {
    throw new HttpError(400, `Unknown vessel status "${status}"`, "invalid_status");
  }

  const include = { _count: { select: { bookings: true } } } as const;

  const { rows, count } =
    await crud.list<Prisma.ShippingVesselGetPayload<{ include: typeof include }>>(
      prisma.shippingVessel,
      user.id,
      { where: status ? { status } : {}, orderBy: { createdAt: "desc" }, include },
    );

  return ok({ vessels: rows, count });
});

/** POST /api/vessels — register a vessel. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  const body = createVesselSchema.parse(await req.json());

  const existing = await prisma.shippingVessel.count({
    where: { userId: user.id, imoNumber: body.imoNumber },
  });
  if (existing) {
    throw new HttpError(409, `Vessel IMO ${body.imoNumber} already exists`, "duplicate");
  }

  const vessel = await crud.create(prisma.shippingVessel, user.id, {
    name: body.name,
    imoNumber: body.imoNumber,
    flag: body.flag ?? null,
    vesselType: body.vesselType ?? null,
    capacityTeu: body.capacityTeu ?? null,
    deadweightTons: body.deadweightTons ?? null,
    status: body.status as ShippingVesselStatus,
  });

  return ok(vessel, 201);
});
