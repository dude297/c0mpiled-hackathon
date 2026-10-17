import type { Metadata } from "next";
import { HomeDashboard } from "@/components/home/HomeDashboard";

export const metadata: Metadata = { title: "Home · DayBridge" };

// U2 Home dashboard (docs/product/SCREENS.md).
export default function HomePage() {
  return <HomeDashboard />;
}
