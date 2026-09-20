import Link from "next/link";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function TrucksPage() {
  const user = await requireUser();

  const trucks = await prisma.truck.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white lg:p-10">
      <div className="mx-auto max-w-7xl">

        <div className="mb-8">
          <Link
            href="/dashboard"
            className="text-sm text-cyan-400"
          >
            ← Dashboard
          </Link>

          <div className="mt-5 flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-black">
                Fleet
              </h1>

              <p className="mt-2 text-slate-400">
                Manage every truck in your operation.
              </p>
            </div>
          </div>
        </div>

        {trucks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-12 text-center">
            <div className="text-5xl">🚛</div>
            <h2 className="mt-4 text-xl font-bold">
              Your fleet is empty
            </h2>
            <p className="mt-2 text-slate-500">
              Trucks added through the API will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {trucks.map((truck) => (
              <div
                key={truck.id}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="text-3xl">🚛</div>

                  <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400">
                    {truck.status}
                  </span>
                </div>

                <h2 className="mt-5 text-xl font-bold">
                  {truck.licensePlate}
                </h2>

                <p className="mt-1 text-sm text-slate-400">
                  {truck.make || "Unknown manufacturer"}{" "}
                  {truck.model || ""}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-950 p-3">
                    <div className="text-slate-500">
                      Mileage
                    </div>
                    <div className="mt-1 font-semibold">
                      {((truck as any)?.mileage ?? 0).toLocaleString()} km
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <div className="text-slate-500">
                      Fuel
                    </div>
                    <div className="mt-1 font-semibold">
                      {((truck as any)?.fuelLevel ?? 0)}%
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  );
}
