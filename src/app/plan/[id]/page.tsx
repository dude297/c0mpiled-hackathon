import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getShare, shareStoreKind } from "@/lib/share/share";

// Read-only, redacted shared plan. Blocks on the server so missing/expired/revoked links get a real 404.
export const instant = false;
export const metadata: Metadata = { title: "Shared plan · DayBridge", robots: { index: false, follow: false } };

export default async function SharedPlanPage(props: PageProps<"/plan/[id]">) {
  await connection();
  const { id } = await props.params;
  const plan = await getShare(id);
  if (!plan) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Shared DayBridge plan · read-only</p>
        <h1 className="text-2xl font-semibold">{plan.summary}</h1>
      </header>
      {plan.items.length > 0 && (
        <ul className="space-y-3">
          {plan.items.map((i) => (
            <li key={i.name} className="rounded-lg border p-4">
              <p className="font-medium">{i.name}</p>
              <p className="text-sm text-muted-foreground">
                {i.when} · {i.travel} · {i.costPerWeek ? `$${i.costPerWeek}/week` : "free"}
              </p>
              {i.tips.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {i.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer className="space-y-1 border-t pt-4 text-sm text-muted-foreground">
        <p>
          Plan checked by deterministic rules. The AI explanation ({plan.dataSource === "live" ? "live AI" : "mock AI"}) is not included in shared
          links; personal details are removed.
        </p>
        <p>
          {shareStoreKind() === "memory" ? "Demo link — valid while this demo server is running, until" : "Link valid until"}{" "}
          {new Date(plan.expiresAt).toUTCString()}.
        </p>
      </footer>
    </main>
  );
}
