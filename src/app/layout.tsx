import type { Metadata } from "next";
import { Suspense } from "react";
import { AudioNavigation } from "@/features/audio-navigation/AudioNavigation";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DayBridge",
  description: "Weekly social plans for older adults that work around real-life barriers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}><AudioNavigation /></Suspense>
        <span id="daybridge-content-start" tabIndex={-1} />
        {children}
      </body>
    </html>
  );
}
