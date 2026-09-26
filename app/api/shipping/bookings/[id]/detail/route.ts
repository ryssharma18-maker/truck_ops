import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { bookingDetail } from "@/lib/services/shippingService";

export const dynamic = "force-dynamic";

export const GET = handle(
  async (_req: NextRequest, { params }: { params: { id: string } }) =>
    ok(await bookingDetail((await requireUser()).id, params.id)),
);
