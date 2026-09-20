import { requirePageUser } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requirePageUser();

  const rows = await prisma.load.findMany({ where: { userId: user.id }, take: 100 });
  const cols = rows.length > 0 ? Object.keys(rows[0] ?? {}).filter((k) => k !== "userId") : [];
  return (
    <div style={{ padding: 32, color: "#e5eefc" }}>
      <a href="/dashboard" style={{ color: "#22d3ee" }}>&larr; Back to dashboard</a>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "16px 0" }}>Trips</h1>
      {rows.length === 0 ? (
        <p>No records yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #334155" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c} style={{ padding: 8, borderBottom: "1px solid #1e293b" }}>
                      {String((r as Record<string, unknown>)[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}