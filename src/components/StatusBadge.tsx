import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "online" | "offline" | "active" | "ended" | "connecting";
  className?: string;
}

const statusConfig = {
  online: { label: "Online", dotClass: "bg-status-online", textClass: "text-status-online" },
  offline: { label: "Offline", dotClass: "bg-status-offline", textClass: "text-status-offline" },
  active: { label: "Active", dotClass: "bg-status-online", textClass: "text-status-online" },
  ended: { label: "Ended", dotClass: "bg-status-offline", textClass: "text-status-offline" },
  connecting: { label: "Connecting", dotClass: "bg-status-connecting", textClass: "text-status-connecting" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", config.textClass, className)}>
      <span className={cn("h-2 w-2 rounded-full", config.dotClass, status === "online" || status === "active" ? "animate-pulse-glow" : "")} />
      {config.label}
    </span>
  );
}
