import type { Metadata } from "next";
import { CareDashboard } from "@/components/care/CareDashboard";

export const metadata: Metadata = { title: "Caregiver view · DayBridge" };

// C1 Caregiver dashboard (docs/product/SCREENS.md "C1"). Client-only data: the device store in this browser.
export default function CarePage() {
  return <CareDashboard />;
}
