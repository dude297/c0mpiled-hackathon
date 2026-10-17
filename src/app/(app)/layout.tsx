import { Header } from "@/components/shell/Header";
import { DeviceStoreProvider } from "@/components/shell/store";

// App shell for every DayBridge screen: sticky header + one shared device store.
// Width ~1200px so the week calendar has room; 16px gutters on phones.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeviceStoreProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-xl border bg-background px-4 py-3 text-lg font-semibold text-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:outline-2 focus:outline-offset-2 focus:outline-foreground print:hidden"
      >
        Skip to main content
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[75rem] flex-1 scroll-mt-36 px-4 py-6 text-lg outline-none md:scroll-mt-24 md:px-6 md:py-8">
        {children}
      </main>
    </DeviceStoreProvider>
  );
}
