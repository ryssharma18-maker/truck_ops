import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { shippingSummary } from "@/lib/services/shippingService";

export const dynamic = "force-dynamic";

export const GET = handle(async () =>
  ok(await shippingSummary((await requireUser()).id)),
);
