import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import * as crud from "@/lib/crudService";
import { HttpError } from "@/lib/errors";
import { assertCanCreate } from "@/lib/planLimits";

export const dynamic = "force-dynamic";

const bookingStatus = z.enum([
  "pending",
  "confirmed",
  "loaded",
  "in_transit",
  "arrived",
  "delivered",
  "cancelled",
]);

const createBookingSchema = z.object({
  bookingNumber: z.string().min(1, "Booking number is required").max(64),
  shipperName: z.string().min(1, "Shipper is required").max(160),
  consigneeName: z.string().min(1, "Consignee is required").max(160),
  vesselId: z.string().uuid().optional(),
  portOfLoadingId: z.string().uuid().optional(),
  portOfDischargeId: z.string().uuid().optional(),
  etd: z.coerce.date().optional(),
  eta: z.coerce.date().optional(),
  freightTerms: z.string().max(32).optional(),
  commodity: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
  status: bookingStatus.default("pending"),
});

/** Rejects any related id that is not one of the caller's own rows. */
async function assertOwned(
  delegate: { count(args: object): Promise<number> },
  userId: string,
  id: string | undefined,
  label: string,
) {
  if (!id) return;
  const found = await delegate.count({ where: { id, userId } });
  if (!found) throw new HttpError(400, `${label} is not one of your records`, "invalid_reference");
}

/** GET /api/bookings — the caller's shipping bookings. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const status = new URL(req.url).searchParams.get("status");

  if (status && !bookingStatus.safeParse(status).success) {
    throw new HttpError(400, `Unknown booking status "${status}"`, "invalid_status");
  }

  const include = {
    vessel: true,
    portOfLoading: true,
    portOfDischarge: true,
    _count: { select: { containers: true, documents: true, invoices: true } },
  } as const;

  const { rows, count } =
    await crud.list<Prisma.ShippingBookingGetPayload<{ include: typeof include }>>(
      prisma.shippingBooking,
      user.id,
      { where: status ? { status } : {}, orderBy: { createdAt: "desc" }, include },
    );

  return ok({ bookings: rows, count });
});

/** POST /api/bookings — create a shipping booking. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  await assertCanCreate(user, "booking");
  const body = createBookingSchema.parse(await req.json());

  const duplicate = await prisma.shippingBooking.count({
    where: { userId: user.id, bookingNumber: body.bookingNumber },
  });
  if (duplicate) {
    throw new HttpError(409, `Booking ${body.bookingNumber} already exists`, "duplicate");
  }

  await assertOwned(prisma.shippingVessel, user.id, body.vesselId, "vesselId");
  await assertOwned(prisma.shippingPort, user.id, body.portOfLoadingId, "portOfLoadingId");
  await assertOwned(prisma.shippingPort, user.id, body.portOfDischargeId, "portOfDischargeId");

  const booking = await crud.create(prisma.shippingBooking, user.id, {
    bookingNumber: body.bookingNumber,
    shipperName: body.shipperName,
    consigneeName: body.consigneeName,
    vesselId: body.vesselId ?? null,
    portOfLoadingId: body.portOfLoadingId ?? null,
    portOfDischargeId: body.portOfDischargeId ?? null,
    etd: body.etd ?? null,
    eta: body.eta ?? null,
    freightTerms: body.freightTerms ?? null,
    commodity: body.commodity ?? null,
    notes: body.notes ?? null,
    status: body.status,
  });

  return ok(booking, 201);
});
