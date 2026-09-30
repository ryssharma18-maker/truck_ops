import { z } from "zod";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { assertTransition } from "@/lib/loadStatus";

export const dynamic = "force-dynamic";

const patchLoadSchema = z.object({
  driverId: z.string().uuid().nullish(),
  truckId: z.string().uuid().nullish(),
  brokerId: z.string().uuid().nullish(),
  status: z.enum(["pending", "in_transit", "delivered", "invoiced", "paid", "overdue"]).optional(),
  pickupDate: z.coerce.date().nullish(),
  deliveryDate: z.coerce.date().nullish(),
  actualDeliveryDate: z.coerce.date().nullish(),
  notes: z.string().max(4000).nullish(),
});

/**
 * Status moves are validated by lib/loadStatus.ts, not just constrained to the
 * enum — see the comment there for why an arbitrary jump is a money bug.
 */

/**
 * PATCH /api/loads/[id] — update an assignment or status on one of the
 * caller's loads. Every referenced truck/driver/broker must belong to the same
 * tenant, otherwise a user could attach someone else's driver to their load.
 */
export const PATCH = handle(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser();
    const body = patchLoadSchema.parse(await req.json());

    const load = await prisma.load.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, status: true },
    });
    if (!load) throw new HttpError(404, "Load not found", "not_found");

    if (body.status) assertTransition(load.status, body.status);

    const references: {
      field: "driverId" | "truckId" | "brokerId";
      delegate: { count(args: object): Promise<number> };
      label: string;
    }[] = [
      { field: "driverId", delegate: prisma.driver, label: "driverId" },
      { field: "truckId", delegate: prisma.truck, label: "truckId" },
      { field: "brokerId", delegate: prisma.broker, label: "brokerId" },
    ];

    for (const { field, delegate, label } of references) {
      const value = body[field];
      if (!value) continue;
      const found = await delegate.count({ where: { id: value, userId: user.id } });
      if (!found) {
        throw new HttpError(400, `${label} is not one of your records`, "invalid_reference");
      }
    }

    const updated = await prisma.load.update({
      where: { id: load.id },
      data: {
        ...(body.driverId !== undefined && { driverId: body.driverId }),
        ...(body.truckId !== undefined && { truckId: body.truckId }),
        ...(body.brokerId !== undefined && { brokerId: body.brokerId }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.pickupDate !== undefined && { pickupDate: body.pickupDate }),
        ...(body.deliveryDate !== undefined && { deliveryDate: body.deliveryDate }),
        ...(body.actualDeliveryDate !== undefined && { actualDeliveryDate: body.actualDeliveryDate }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
      include: { truck: true, driver: true, broker: true },
    });

    return ok(updated);
  },
);
