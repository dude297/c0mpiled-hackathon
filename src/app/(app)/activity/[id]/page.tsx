import type { Metadata } from "next";

export const metadata: Metadata = { title: "Activity · DayBridge" };

// Placeholder: the U5 screen builder replaces this (docs/product/SCREENS.md U5).
// Read the id with PageProps<"/activity/[id]"> (await params inside <Suspense>: cacheComponents is on) or useParams().
export default function ActivityPage() {
  return <h1 className="text-[2.25rem] font-semibold leading-tight">Activity</h1>;
}
