"use client";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PerfMonthlyTrendPoint } from "@/lib/types";
import { fmtMoney } from "@/lib/utils";

/** Convert "YYYY-MM" → "Jan 25". */
function shortMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  if (!y || !m) return yyyymm;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

export function PerformanceTrendChart({ data }: { data: PerfMonthlyTrendPoint[] }) {
  const rows = data.map((d) => ({ ...d, label: shortMonth(d.month) }));
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="kpi-label">Monthly trend · Spend / Revenue / P&amp;L</div>
        <div className="text-xs text-muted">Last 12 months</div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="perfRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(34 197 94)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="rgb(34 197 94)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="perfSp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgb(39 39 42)" vertical={false} />
            <XAxis dataKey="label" stroke="rgb(161 161 170)" fontSize={11} />
            <YAxis
              stroke="rgb(161 161 170)"
              fontSize={11}
              tickFormatter={(v) => fmtMoney(Number(v))}
              width={80}
            />
            <Tooltip
              contentStyle={{
                background: "rgb(24 24 27)",
                border: "1px solid rgb(39 39 42)",
                borderRadius: 8,
              }}
              labelStyle={{ color: "rgb(244 244 245)" }}
              formatter={(v: any, name: any) => [fmtMoney(Number(v)), String(name)]}
            />
            <Legend wrapperStyle={{ color: "rgb(161 161 170)", fontSize: 11 }} />
            <Area
              type="monotone"
              name="Revenue"
              dataKey="revenue"
              stroke="rgb(34 197 94)"
              fill="url(#perfRev)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              name="Spend"
              dataKey="spend"
              stroke="rgb(99 102 241)"
              fill="url(#perfSp)"
              strokeWidth={2}
            />
            <Bar name="P&L" dataKey="pnl" barSize={14} fill="rgb(250 204 21)" radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
