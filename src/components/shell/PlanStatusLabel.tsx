import { CircleAlert, CircleCheck, CircleDashed, Clock } from "lucide-react";
import type { StatusIcon, StatusView } from "./helpers";

const ICONS: Record<StatusIcon, typeof Clock> = { alert: CircleAlert, pending: CircleDashed, waiting: Clock, check: CircleCheck };
const TONE: Record<StatusIcon, string> = {
  alert: "text-amber-700 dark:text-amber-400",
  pending: "text-foreground/75",
  waiting: "text-foreground/75",
  check: "text-green-700 dark:text-green-400",
};

/** Status word + icon (never color alone, never a raw state name). */
export function PlanStatusLabel({ view, className = "" }: { view: StatusView; className?: string }) {
  const Icon = view.icon ? ICONS[view.icon] : null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {Icon && <Icon className={`size-5 shrink-0 ${TONE[view.icon!]}`} aria-hidden="true" />}
      <span>{view.word}</span>
    </span>
  );
}
