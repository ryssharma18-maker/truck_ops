import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import * as crud from "@/lib/crudService";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const invoiceStatus = z.enum([
  "draft",
  "sent",
  "submitted_to_factor",
  "paid",
  "overdue",
  "disputed",
]);

/** GET /api/invoices — the caller's invoices, with load and broker joined. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const status = new URL(req.url).searchParams.get("status");

  if (status && !invoiceStatus.safeParse(status).success) {
    throw new HttpError(400, `Unknown invoice status "${status}"`, "invalid_status");
  }

  const include = {
    load: { select: { id: true, loadNumber: true, status: true } },
    broker: { select: { id: true, companyName: true, paymentTermsDays: true } },
  } as const;

  const { rows, count } = await crud.list<Prisma.InvoiceGetPayload<{ include: typeof include }>>(
    prisma.invoice,
    user.id,
    { where: status ? { status } : {}, orderBy: { invoiceDate: "desc" }, include },
  );

  return ok({ invoices: rows, count });
});
