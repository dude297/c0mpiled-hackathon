import type { Metadata } from "next";
import { CareDashboard } from "@/components/care/CareDashboard";

export const metadata: Metadata = { title: "Caregiver view · DayBridge" };

// API-backed caregiver view, with an explicitly labelled same-device demo fallback.
export default function CarePage() {
  return <CareDashboard />;
}
