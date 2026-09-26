import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import * as crud from "@/lib/crudService";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const loadStatus = z.enum([
  "pending",
  "in_transit",
  "delivered",
  "invoiced",
  "paid",
  "overdue",
]);

/** Accepts a hand-written load or the JSON that aiService extracts from a rate confirmation. */
const createLoadSchema = z.object({
  loadNumber: z.string().min(1, "Load number is required").max(64),
  status: loadStatus.default("pending"),
  brokerName: z.string().max(160).optional(),
  shipperName: z.string().max(160).optional(),
  consigneeName: z.string().max(160).optional(),
  shipperAddress: z.string().max(400).optional(),
  consigneeAddress: z.string().max(400).optional(),
  originCity: z.string().max(120).optional(),
  originState: z.string().length(2).optional(),
  destinationCity: z.string().max(120).optional(),
  destinationState: z.string().length(2).optional(),
  pickupDate: z.coerce.date().optional(),
  deliveryDate: z.coerce.date().optional(),
  commodity: z.string().max(200).optional(),
  weightLbs: z.coerce.number().min(0).optional(),
  palletCount: z.coerce.number().int().min(0).optional(),
  rateAmount: z.coerce.number().min(0).default(0),
  fuelSurcharge: z.coerce.number().min(0).default(0),
  detentionAmount: z.coerce.number().min(0).default(0),
  lumperAmount: z.coerce.number().min(0).default(0),
  truckId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  notes: z.string().max(4000).optional(),
});

const INCLUDE = {
  truck: { select: { id: true, truckNumber: true } },
  driver: { select: { id: true, fullName: true } },
  broker: { select: { id: true, companyName: true } },
  _count: { select: { documents: true, invoices: true, detentionRecords: true } },
} as const;

/** GET /api/loads — the caller's loads, newest first. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  if (status && !loadStatus.safeParse(status).success) {
    throw new HttpError(400, `Unknown load status "${status}"`, "invalid_status");
  }

  const { rows, count } = await crud.list<Prisma.LoadGetPayload<{ include: typeof INCLUDE }>>(
    prisma.load,
    user.id,
    { where: status ? { status } : {}, orderBy: { createdAt: "desc" }, include: INCLUDE },
  );

  return ok({ loads: rows, count });
});

/** POST /api/loads — create a load, optionally linking a broker by name. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  const body = createLoadSchema.parse(await req.json());

  const duplicate = await prisma.load.count({
    where: { userId: user.id, loadNumber: body.loadNumber },
  });
  if (duplicate) {
    throw new HttpError(409, `Load ${body.loadNumber} already exists`, "duplicate");
  }

  for (const [field, delegate, label] of [
    ["truckId", prisma.truck, "truckId"],
    ["driverId", prisma.driver, "driverId"],
  ] as const) {
    const value = body[field];
    if (!value) continue;
    const found = await (delegate as { count(args: object): Promise<number> }).count({
      where: { id: value, userId: user.id },
    });
    if (!found) {
      throw new HttpError(400, `${label} is not one of your records`, "invalid_reference");
    }
  }

  // Brokers are keyed by company name per tenant — reuse the existing row so
  // invoices and loads stay linked. (Broker has no unique index on companyName,
  // so do this as find-then-create rather than an upsert.)
  let brokerId: string | null = null;
  if (body.brokerName) {
    const existing = await prisma.broker.findFirst({
      where: { userId: user.id, companyName: body.brokerName },
      select: { id: true },
    });
    brokerId =
      existing?.id ??
      (
        await prisma.broker.create({
          data: { userId: user.id, companyName: body.brokerName },
          select: { id: true },
        })
      ).id;
  }

  const total =
    body.rateAmount + body.fuelSurcharge + body.detentionAmount + body.lumperAmount;

  const load = await crud.create(prisma.load, user.id, {
    loadNumber: body.loadNumber,
    status: body.status,
    brokerId,
    truckId: body.truckId ?? null,
    driverId: body.driverId ?? null,
    shipperName: body.shipperName ?? null,
    shipperAddress: body.shipperAddress ?? null,
    consigneeName: body.consigneeName ?? null,
    consigneeAddress: body.consigneeAddress ?? null,
    pickupDate: body.pickupDate ?? null,
    deliveryDate: body.deliveryDate ?? null,
    commodity: body.commodity ?? null,
    weightLbs: body.weightLbs ?? null,
    palletCount: body.palletCount ?? null,
    rateAmount: body.rateAmount,
    fuelSurcharge: body.fuelSurcharge,
    detentionAmount: body.detentionAmount,
    lumperAmount: body.lumperAmount,
    totalInvoiceAmount: total,
    notes: body.notes ?? null,
  });

  return ok(load, 201);
});
