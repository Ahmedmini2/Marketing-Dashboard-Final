"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PerfTopCampaign } from "@/lib/types";
import { fmtMoney } from "@/lib/utils";

/**
 * Horizontal bar chart of best-performing campaigns this month, ranked by P&L.
 * Green bars = profitable, red bars = losing money.
 */
export function TopCampaignsChart({ campaigns }: { campaigns: PerfTopCampaign[] }) {
  const rows = [...campaigns]
    .map((c) => ({
      name: c.campaign_name,
      pnl: c.pnl,
      spend: c.spend,
      revenue: c.revenue,
      roas: c.roas,
      event_type: c.event_type,
    }))
    .reverse(); // first item ends up at the bottom in vertical layout — reverse

  const height = Math.max(220, rows.length * 36);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="kpi-label">📈 Best Campaigns · This Month (by P&amp;L)</div>
        <div className="text-xs text-muted">{campaigns.length} campaigns</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted py-8 text-center">No campaigns with activity this month.</div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 80, left: 12, bottom: 4 }}
              barCategoryGap={6}
            >
              <CartesianGrid stroke="rgb(39 39 42)" horizontal={false} />
              <XAxis
                type="number"
                stroke="rgb(161 161 170)"
                fontSize={11}
                tickFormatter={(v) => fmtMoney(Number(v))}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="rgb(161 161 170)"
                fontSize={12}
                width={180}
                tick={{ fill: "rgb(244 244 245)" }}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "rgb(24 24 27)",
                  border: "1px solid rgb(39 39 42)",
                  borderRadius: 8,
                }}
                labelStyle={{ color: "rgb(244 244 245)" }}
                formatter={(value, name) => {
                  if (name === "pnl") return [fmtMoney(Number(value)), "P&L"];
                  return [value as any, name as any];
                }}
                labelFormatter={(label, payload) => {
                  const p = payload?.[0]?.payload as
                    | { name: string; spend: number; revenue: number; roas: number }
                    | undefined;
                  if (!p) return String(label);
                  return `${p.name} · spend ${fmtMoney(p.spend)} · rev ${fmtMoney(p.revenue)} · ${p.roas.toFixed(2)}x`;
                }}
              />
              <Bar dataKey="pnl" radius={[0, 6, 6, 0]}>
                {rows.map((r, i) => (
                  <Cell key={i} fill={r.pnl >= 0 ? "rgb(34 197 94)" : "rgb(239 68 68)"} />
                ))}
                <LabelList
                  dataKey="pnl"
                  position="right"
                  fill="rgb(244 244 245)"
                  fontSize={11}
                  formatter={(v: any) => fmtMoney(Number(v))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
