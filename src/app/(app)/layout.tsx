import { Header } from "@/components/shell/Header";
import { DeviceStoreProvider } from "@/components/shell/store";

// App shell for every DayBridge screen: sticky header + one shared device store.
// Width ~1200px so the week calendar has room; 16px gutters on phones.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeviceStoreProvider>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[75rem] flex-1 px-4 py-6 text-lg md:px-6 md:py-8">
        {children}
      </main>
    </DeviceStoreProvider>
  );
}
