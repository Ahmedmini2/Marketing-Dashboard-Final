"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function TrendChart({ data }: { data: { date: string; spend: number; revenue: number; profit: number }[] }) {
  return (
    <div className="panel p-4">
      <div className="kpi-label mb-3">Spend vs. Revenue</div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(34 197 94)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="rgb(34 197 94)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="sp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgb(39 39 42)" vertical={false} />
            <XAxis dataKey="date" stroke="rgb(161 161 170)" fontSize={11} />
            <YAxis stroke="rgb(161 161 170)" fontSize={11} />
            <Tooltip
              contentStyle={{ background: "rgb(24 24 27)", border: "1px solid rgb(39 39 42)", borderRadius: 8 }}
              labelStyle={{ color: "rgb(244 244 245)" }}
            />
            <Area type="monotone" dataKey="revenue" stroke="rgb(34 197 94)" fill="url(#rev)" strokeWidth={2} />
            <Area type="monotone" dataKey="spend" stroke="rgb(99 102 241)" fill="url(#sp)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
