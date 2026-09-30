import type { Metadata } from "next";
import { Package, Snowflake, Weight } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DataTable,
  TableRow,
  Cell,
  PageHeader,
  StatCard,
  EmptyState,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Containers | TruckOps AI" };

const SIZE_LABEL: Record<string, string> = {
  ft20: "20 ft",
  ft40: "40 ft",
  ft40hc: "40 ft high cube",
  ft45: "45 ft high cube",
};

export default async function ShippingContainersPage() {
  const user = await requirePageUser();
  const userId = user.id;

  const [containers, total, reefer, unassigned, totalWeight] = await Promise.all([
    prisma.shippingContainer.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { booking: { select: { id: true, bookingNumber: true } } },
    }),
    prisma.shippingContainer.count({ where: { userId } }),
    prisma.shippingContainer.count({ where: { userId, type: "reefer" } }),
    prisma.shippingContainer.count({ where: { userId, bookingId: null } }),
    prisma.shippingContainer.aggregate({ where: { userId }, _sum: { weightKg: true } }),
  ]);

  const tonnes = (totalWeight._sum.weightKg?.toNumber() ?? 0) / 1000;

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Containers"
        subtitle="Equipment on the water and in the yard across every booking"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total containers"
          value={total}
          hint={total > containers.length ? `showing the ${containers.length} most recent` : undefined}
          icon={<Package className="h-4 w-4 text-sky-400" />}
        />
        <StatCard
          label="Reefer"
          value={reefer}
          icon={<Snowflake className="h-4 w-4 text-cyan-400" />}
        />
        <StatCard
          label="Unassigned"
          value={unassigned}
          hint={`${tonnes.toFixed(1)} t total cargo weight`}
          icon={<Weight className="h-4 w-4 text-amber-400" />}
        />
      </div>

      {containers.length === 0 ? (
        <EmptyState
          title="No containers recorded"
          body="Containers are created from a shipping booking once the carrier confirms equipment."
        />
      ) : (
        <DataTable head={["Container #", "Size", "Type", "Seal", "Weight", "Booking"]}>
          {containers.map((c) => (
            <TableRow key={c.id}>
              <td className="px-4 py-3 font-mono font-medium text-white">{c.containerNumber}</td>
              <Cell>{SIZE_LABEL[c.size] ?? c.size}</Cell>
              <Cell>{c.type.replace(/_/g, " ")}</Cell>
              <Cell>{c.sealNumber ?? "—"}</Cell>
              <Cell>
                {c.weightKg ? `${c.weightKg.toNumber().toLocaleString()} kg` : "—"}
              </Cell>
              <Cell>{c.booking?.bookingNumber ?? "Unassigned"}</Cell>
            </TableRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
