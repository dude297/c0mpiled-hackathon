"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, CalendarDays, Compass, Route, Sun } from "lucide-react";

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="app-header print:hidden">
      <Link href="/" className="brand" aria-label="DayBridge home"><span className="brand-mark"><Sun size={23} strokeWidth={1.7} /></span>DayBridge<span className="brand-dot">.</span></Link>
      <nav aria-label="Main navigation" className="app-nav">
        <Link href="/" aria-current={path === "/" ? "page" : undefined}><Compass size={17} />Discover</Link>
        <Link href="/coordinate" aria-current={path === "/coordinate" ? "page" : undefined}><Route size={17} />Your plan</Link>
      </nav>
      <span className="header-note"><CalendarDays size={16} />More moments that matter <ArrowUpRight size={15} /></span>
    </header>
  );
}
