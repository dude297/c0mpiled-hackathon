import type { Metadata } from "next";
import { MatchesView } from "@/components/views/MatchesView";

export const metadata: Metadata = { title: "Matches · DayBridge" };

// U3 Matches (docs/product/SCREENS.md).
export default function MatchesPage() {
  return <MatchesView />;
}
