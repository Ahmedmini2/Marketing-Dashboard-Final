"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PerfTopAgent } from "@/lib/types";
import { fmtMoney, fmtNum } from "@/lib/utils";

/**
 * Horizontal bar chart of top-N agents this month, ranked by bookings (BNL).
 * Highest performer rendered at the top.
 */
export function TopAgentsChart({ agents }: { agents: PerfTopAgent[] }) {
  const rows = [...agents]
    .map((a) => ({
      name: a.agent_name ?? "(unknown)",
      bookings: a.bookings,
      revenue: a.revenue,
      leads: a.leads,
      team: a.team_name ?? "",
    }))
    .reverse(); // recharts horizontal: first item renders bottom — reverse for #1 on top

  const height = Math.max(220, rows.length * 38);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="kpi-label">🏆 Top Agents · This Month (by bookings)</div>
        <div className="text-xs text-muted">{agents.length} agents</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted py-8 text-center">No bookings yet this month.</div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 56, left: 12, bottom: 4 }}
              barCategoryGap={6}
            >
              <defs>
                <linearGradient id="agentBar" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="rgb(99 102 241)" stopOpacity={0.85} />
                  <stop offset="100%" stopColor="rgb(168 85 247)" stopOpacity={0.95} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgb(39 39 42)" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                stroke="rgb(161 161 170)"
                fontSize={11}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="rgb(161 161 170)"
                fontSize={12}
                width={140}
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
                formatter={(value, name, item) => {
                  if (name === "bookings") return [fmtNum(Number(value)), "Bookings"];
                  return [value as any, name as any];
                }}
                labelFormatter={(label, payload) => {
                  const p = payload?.[0]?.payload as
                    | { name: string; team: string; revenue: number; leads: number }
                    | undefined;
                  if (!p) return String(label);
                  return `${p.name}${p.team ? " · " + p.team : ""}`;
                }}
              />
              <Bar dataKey="bookings" fill="url(#agentBar)" radius={[0, 6, 6, 0]}>
                <LabelList
                  dataKey="bookings"
                  position="right"
                  fill="rgb(244 244 245)"
                  fontSize={11}
                  formatter={(v: any) => fmtNum(Number(v))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {agents.slice(0, 3).map((a, i) => (
            <div key={a.agent_id ?? i} className="rounded-lg border border-border bg-white/[0.02] p-2">
              <div className="text-muted">
                {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {a.agent_name ?? "—"}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="kpi-num text-base">{fmtNum(a.bookings)}</span>
                <span className="text-muted">bookings · {fmtMoney(a.revenue)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
