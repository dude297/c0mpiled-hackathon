import type { Metadata } from "next";
import { CalendarView } from "@/components/views/CalendarView";

export const metadata: Metadata = { title: "Calendar · DayBridge" };

// U4 Calendar (docs/product/SCREENS.md), opened from the header calendar icon.
export default function CalendarPage() {
  return <CalendarView />;
}
