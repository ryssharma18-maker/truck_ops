import Link from "next/link";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const user = await requireUser();

  const [
    truckCount,
    activeTruckCount,
    driverCount,
    activeTripCount,
    openAlertCount,
    maintenanceCount,
  ] = await Promise.all([
    prisma.truck.count({
      where: { userId: user.id },
    }),

    prisma.truck.count({
      where: {
        userId: user.id,
        status: "active",
      },
    }),

    prisma.driver.count({
      where: {
        userId: user.id,
      },
    }),

    prisma.load.count({
      where: {
        userId: user.id,
        status: "in_transit",
      },
    }),

    prisma.notification.count({
      where: {
        userId: user.id,
        read: false,
      },
    }),

    prisma.truck.count({ where: { userId: user.id, status: "maintenance" } }),
  ]);

  const recentTrips = await prisma.load.findMany({
    where: {
      userId: user.id,
    },
    include: {
      truck: true,
      driver: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 5,
  });

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen">

        <aside className="hidden w-64 border-r border-slate-800 bg-slate-900/80 p-6 lg:block">
          <div className="mb-10">
            <div className="text-2xl font-black">
              🚛 TruckOps
            </div>
            <div className="text-xs text-cyan-400">
              AI OPERATIONS
            </div>
          </div>

          <nav className="space-y-2">
            <Link
              href="/dashboard"
              className="block rounded-xl bg-cyan-500/10 px-4 py-3 text-cyan-400"
            >
              Dashboard
            </Link>

            <Link
              href="/dashboard/trucks"
              className="block rounded-xl px-4 py-3 text-slate-300 hover:bg-slate-800"
            >
              🚛 Trucks
            </Link>

            <Link
              href="/dashboard/drivers"
              className="block rounded-xl px-4 py-3 text-slate-300 hover:bg-slate-800"
            >
              👤 Drivers
            </Link>

            <Link
              href="/dashboard/trips"
              className="block rounded-xl px-4 py-3 text-slate-300 hover:bg-slate-800"
            >
              🛣 Trips
            </Link>

            <Link
              href="/dashboard/maintenance"
              className="block rounded-xl px-4 py-3 text-slate-300 hover:bg-slate-800"
            >
              🔧 Maintenance
            </Link>

            <Link
              href="/dashboard/alerts"
              className="block rounded-xl px-4 py-3 text-slate-300 hover:bg-slate-800"
            >
              ⚠ Alerts
            </Link>
          </nav>
        </aside>

        <section className="flex-1 p-6 lg:p-10">
          <div className="mx-auto max-w-7xl">

            <header className="mb-10">
              <div className="text-sm font-semibold text-cyan-400">
                TRUCKOPS AI
              </div>

              <h1 className="mt-2 text-4xl font-black tracking-tight">
                Fleet Command Center
              </h1>

              <p className="mt-2 text-slate-400">
                Welcome back{user.email ? `, ${user.email}` : ""}.
                Your fleet intelligence center is online.
              </p>
            </header>

            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">

              <StatCard
                title="Total Trucks"
                value={truckCount}
                icon="🚛"
              />

              <StatCard
                title="Active Trucks"
                value={activeTruckCount}
                icon="🟢"
              />

              <StatCard
                title="Drivers"
                value={driverCount}
                icon="👤"
              />

              <StatCard
                title="Active Trips"
                value={activeTripCount}
                icon="🛣"
              />

              <StatCard
                title="Open Alerts"
                value={openAlertCount}
                icon="⚠"
              />

              <StatCard
                title="Maintenance"
                value={maintenanceCount}
                icon="🔧"
              />

            </div>

            <div className="mt-10 grid gap-6 xl:grid-cols-3">

              <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 xl:col-span-2">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">
                      Recent Trips
                    </h2>
                    <p className="text-sm text-slate-400">
                      Latest fleet activity
                    </p>
                  </div>

                  <Link
                    href="/dashboard/trips"
                    className="text-sm font-semibold text-cyan-400"
                  >
                    View all →
                  </Link>
                </div>

                {recentTrips.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
                    <div className="text-4xl">🛣</div>
                    <p className="mt-3 font-semibold">
                      No trips yet
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Create your first trip from the Trips module.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentTrips.map((trip) => (
                      <div
                        key={trip.id}
                        className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <div className="font-semibold">
                            {trip.shipperName} → {trip.consigneeName}
                          </div>

                          <div className="mt-1 text-sm text-slate-500">
                            {trip.truck?.licensePlate}
                            {trip.driver
                              ? ` · ${trip.driver.fullName}`
                              : ""}
                          </div>
                        </div>

                        <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
                          {trip.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-slate-900 p-6">
                <div className="text-3xl">🤖</div>

                <h2 className="mt-4 text-xl font-bold">
                  TruckOps AI
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Your operations intelligence layer will analyze
                  fleet utilization, maintenance risk, trip costs,
                  driver performance and operational alerts.
                </p>

                <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    AI Status
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-sm font-semibold">
                      Operations layer online
                    </span>
                  </div>
                </div>
              </section>

            </div>

          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 transition hover:border-cyan-500/30">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">
          {title}
        </span>

        <span className="text-2xl">
          {icon}
        </span>
      </div>

      <div className="mt-4 text-4xl font-black">
        {value}
      </div>
    </div>
  );
}
