import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityDetail } from "@/components/home/ActivityDetail";

export const metadata: Metadata = { title: "Activity · DayBridge" };

// U5 (docs/product/SCREENS.md). The id is only known at request time: the client reads it inside Suspense (cacheComponents).
export default function ActivityPage() {
  return (
    <Suspense fallback={null}>
      <ActivityDetail />
    </Suspense>
  );
}
