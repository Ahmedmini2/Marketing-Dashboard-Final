import { cn } from "@/lib/utils";

export function KpiCard({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "default";
}) {
  return (
    <div className="panel p-4">
      <div className="kpi-label">{label}</div>
      <div className={cn(
        "kpi-num mt-1",
        tone === "good" && "text-good",
        tone === "bad" && "text-bad",
      )}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}
