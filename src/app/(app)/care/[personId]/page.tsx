import type { Metadata } from "next";
import { Suspense } from "react";
import { CareDashboard } from "@/components/care/CareDashboard";

export const metadata: Metadata = { title: "Person · Caregiver view · DayBridge" };

async function PersonContent({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  return <CareDashboard personId={personId} />;
}

export default function CarePersonPage({ params }: { params: Promise<{ personId: string }> }) {
  return <Suspense fallback={<p role="status">Loading caregiver information…</p>}><PersonContent params={params} /></Suspense>;
}
