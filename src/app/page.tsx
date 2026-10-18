import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { Landing } from "@/components/landing/Landing";

const display = Fraunces({ variable: "--font-display", subsets: ["latin"], axes: ["SOFT", "opsz"] });

export const metadata: Metadata = {
  title: "DayBridge — a week that works around her",
  description: "DayBridge finds activities an older adult can actually get to, arranges the ride with her consent, and replans when life changes.",
};

export default function Page() {
  return (
    <div className={display.variable}>
      <Landing />
    </div>
  );
}
