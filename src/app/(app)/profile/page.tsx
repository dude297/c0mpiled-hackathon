import type { Metadata } from "next";
import { ProfileView } from "@/components/views/ProfileView";

export const metadata: Metadata = { title: "Your answers · DayBridge" };

// U6 Profile (docs/product/SCREENS.md).
export default function ProfilePage() {
  return <ProfileView />;
}
