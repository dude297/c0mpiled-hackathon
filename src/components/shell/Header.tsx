"use client";

// App shell header (SCREENS.md "SH"). User: brand · Home · Matches · Calendar · Profile · person menu.
// Caregiver: brand · "Caring for {name}" · Care · Calendar · Profile · person menu ("Back to {name}'s view").
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { FOCUS } from "./focus";
import { personLabel, useDeviceStore, type PersonKey } from "./store";

type NavItem = { href: string; label: string; icon?: boolean };

const USER_NAV: NavItem[] = [
  { href: "/home", label: "Home" },
  { href: "/matches", label: "Matches" },
  { href: "/calendar", label: "Calendar", icon: true },
  { href: "/profile", label: "Profile" },
];
const CARE_NAV: NavItem[] = [
  { href: "/care", label: "Care" },
  { href: "/calendar", label: "Calendar", icon: true },
  { href: "/profile", label: "Profile" },
];

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      // Keep the Calendar word on phones too; its icon alone is easy to miss or misinterpret.
      aria-label={item.icon ? item.label : undefined}
      title={item.icon ? item.label : undefined}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border-b-2 px-1 text-base md:px-3 md:text-lg ${FOCUS} ${
        active ? "border-foreground font-semibold text-foreground" : "border-transparent text-foreground/80 hover:bg-muted hover:text-foreground"
      }`}
    >
      {item.icon && <CalendarDays className="hidden size-6 shrink-0 md:block" aria-hidden="true" />}
      <span>{item.label}</span>
    </Link>
  );
}

const SAMPLES: { key: PersonKey; label: string }[] = [
  { key: "margaret", label: "Margaret" },
  { key: "harold", label: "Harold" },
];

const ITEM = "flex min-h-11 cursor-default items-center gap-2 rounded-lg px-3 text-lg outline-none select-none data-[highlighted]:bg-muted";

function PersonMenu() {
  const router = useRouter();
  const store = useDeviceStore();
  const name = personLabel(store);
  const caregiver = store.mode === "caregiver";
  const showMe = store.person === "me" || store.savedPeople.includes("me");

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${name}, change person or view`}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-lg hover:bg-muted ${FOCUS}`}
      >
        <span className="max-w-[10rem] truncate">{name}</span>
        <ChevronDown className="size-5 shrink-0" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50">
          <Menu.Popup className="min-w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none">
            {caregiver && (
              <>
                <Menu.Item
                  className={ITEM}
                  onClick={() => {
                    store.setMode("user");
                    router.push("/home");
                  }}
                >
                  Back to {name}&apos;s view
                </Menu.Item>
                <Menu.Separator className="my-1.5 h-px bg-border" />
              </>
            )}
            <Menu.RadioGroup value={store.person} onValueChange={(v: PersonKey) => store.selectPerson(v)}>
              {showMe && (
                <Menu.RadioItem value="me" closeOnClick className={ITEM}>
                  <span className="flex size-5 items-center justify-center">
                    <Menu.RadioItemIndicator><Check className="size-5" aria-hidden="true" /></Menu.RadioItemIndicator>
                  </span>
                  You
                </Menu.RadioItem>
              )}
              <Menu.Group>
                <Menu.GroupLabel className="px-3 pt-2 pb-1 text-base text-muted-foreground">Sample people (demo data)</Menu.GroupLabel>
                {SAMPLES.map((s) => (
                  <Menu.RadioItem key={s.key} value={s.key} closeOnClick className={ITEM}>
                    <span className="flex size-5 items-center justify-center">
                      <Menu.RadioItemIndicator><Check className="size-5" aria-hidden="true" /></Menu.RadioItemIndicator>
                    </span>
                    {s.label}
                  </Menu.RadioItem>
                ))}
              </Menu.Group>
            </Menu.RadioGroup>
            {!caregiver && store.profile && (
              <>
                <Menu.Separator className="my-1.5 h-px bg-border" />
                <Menu.Item className={ITEM} onClick={() => router.push("/care")}>
                  Caregiver view for {name}
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function Header() {
  // usePathname is URL data: keep it inside Suspense so every route still prerenders (cacheComponents).
  return (
    <Suspense fallback={<HeaderView pathname="" />}>
      <HeaderWithPath />
    </Suspense>
  );
}

function HeaderWithPath() {
  return <HeaderView pathname={usePathname() ?? ""} />;
}

function HeaderView({ pathname }: { pathname: string }) {
  const store = useDeviceStore();
  const caregiver = store.mode === "caregiver";
  const nav = caregiver ? CARE_NAV : USER_NAV;
  const name = personLabel(store);


  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden">
      <div className="mx-auto flex w-full max-w-[75rem] items-center gap-2 px-4 py-2 md:gap-4 md:px-6">
        <Link href={caregiver ? "/care" : "/home"} className={`inline-flex min-h-11 items-center rounded-lg px-1 text-xl font-semibold ${FOCUS}`}>
          DayBridge
        </Link>
        {caregiver && store.profile && <p className="hidden text-lg text-foreground/80 lg:block">Caring for {name}</p>}
        <nav aria-label="Main" className="ml-auto hidden md:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={isActive(pathname, item.href)} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto md:ml-0">
          <PersonMenu />
        </div>
      </div>
      {caregiver && store.profile && <p className="mx-auto w-full max-w-[75rem] px-4 pb-1 text-base text-foreground/80 md:px-6 lg:hidden">Caring for {name}</p>}
      <nav aria-label="Main" className="border-t md:hidden">
        <ul className={`mx-auto grid max-w-[75rem] px-2 ${caregiver ? "grid-cols-3" : "grid-cols-4"}`}>
          {nav.map((item) => (
            <li key={item.href} className="flex justify-center">
              <NavLink item={item} active={isActive(pathname, item.href)} />
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
