import type { Metadata } from "next";
import { Truck, Wrench } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AddTruckModal } from "@/components/AddTruckModal";
import {
  DataTable,
  TableRow,
  Cell,
  PageHeader,
  EmptyState,
  StatCard,
  StatusPill,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trucks | TruckOps AI" };

export default async function TrucksPage() {
  const user = await requirePageUser();

  const [trucks, active, inMaintenance] = await Promise.all([
    prisma.truck.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { drivers: { select: { id: true, fullName: true } }, _count: { select: { loads: true } } },
    }),
    prisma.truck.count({ where: { userId: user.id, status: "active" } }),
    prisma.truck.count({ where: { userId: user.id, status: "maintenance" } }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Trucks"
        subtitle={`${trucks.length} truck${trucks.length === 1 ? "" : "s"} in your fleet`}
        action={<AddTruckModal />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total trucks" value={trucks.length} icon={<Truck className="h-4 w-4 text-sky-400" />} />
        <StatCard label="Active" value={active} />
        <StatCard
          label="In maintenance"
          value={inMaintenance}
          icon={<Wrench className="h-4 w-4 text-amber-400" />}
        />
      </div>

      {trucks.length === 0 ? (
        <EmptyState
          title="No trucks registered yet"
          body="Add your first truck to start assigning loads and tracking IFTA mileage."
        />
      ) : (
        <DataTable head={["Truck #", "Vehicle", "Year", "Plate", "Drivers", "Loads", "Status"]}>
          {trucks.map((truck) => (
            <TableRow key={truck.id}>
              <td className="px-4 py-3 font-medium text-white">{truck.truckNumber}</td>
              <Cell>
                {[truck.make, truck.model].filter(Boolean).join(" ") || "—"}
              </Cell>
              <Cell>{truck.year ?? "—"}</Cell>
              <Cell>{truck.licensePlate ?? "—"}</Cell>
              <Cell>
                {truck.drivers.length > 0
                  ? truck.drivers.map((d) => d.fullName).join(", ")
                  : "—"}
              </Cell>
              <Cell>{truck._count.loads}</Cell>
              <td className="px-4 py-3">
                <StatusPill value={truck.status} />
              </td>
            </TableRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
