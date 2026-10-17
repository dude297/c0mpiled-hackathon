import Link from "next/link";

export default function SharedPlanNotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 p-6">
      <h1 className="text-2xl font-semibold">This shared plan isn’t available</h1>
      <p className="text-muted-foreground">The link may have expired, been revoked by its owner, or the demo server was restarted.</p>
      <Link href="/" className="underline">
        Go to DayBridge
      </Link>
    </main>
  );
}
