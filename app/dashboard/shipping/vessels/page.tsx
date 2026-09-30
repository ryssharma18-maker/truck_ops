import type { Metadata } from "next";
import { Ship } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AddVesselModal } from "@/components/AddVesselModal";
import { StatusPill, PageHeader, EmptyState } from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vessel Fleet | TruckOps AI" };

export default async function VesselsPage() {
  const user = await requirePageUser();

  const [vessels, vesselCount] = await Promise.all([
    prisma.shippingVessel.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { _count: { select: { bookings: true } } },
    }),
    prisma.shippingVessel.count({ where: { userId: user.id } }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Vessel Fleet"
        subtitle={`${vesselCount} vessel${vesselCount === 1 ? "" : "s"} registered${
          vesselCount > vessels.length ? ` · showing ${vessels.length}` : ""
        }`}
        action={<AddVesselModal />}
      />

      {vessels.length === 0 ? (
        <EmptyState
          title="No vessels yet"
          body="Register the first vessel in your fleet to start booking cargo against it."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vessels.map((vessel) => (
            <article
              key={vessel.id}
              className="rounded-lg border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-slate-700"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                  <Ship className="h-4 w-4 text-cyan-400" />
                  {vessel.name}
                </h3>
                <StatusPill value={vessel.status} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">IMO number</dt>
                  <dd className="font-medium text-white">{vessel.imoNumber}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Flag</dt>
                  <dd className="font-medium text-white">{vessel.flag ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Type</dt>
                  <dd className="font-medium text-white">{vessel.vesselType ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Capacity</dt>
                  <dd className="font-medium text-white">
                    {vessel.capacityTeu ? `${vessel.capacityTeu.toLocaleString()} TEU` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Deadweight</dt>
                  <dd className="font-medium text-white">
                    {vessel.deadweightTons ? `${vessel.deadweightTons.toLocaleString()} t` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Bookings</dt>
                  <dd className="font-medium text-white">{vessel._count.bookings}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
