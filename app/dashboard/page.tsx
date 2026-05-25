import { KpiCard } from "@/components/kpi-card";
import { SyncButton } from "@/components/sync-button";
import { TopAgentsChart } from "@/components/top-agents-chart";
import { TopCampaignsChart } from "@/components/top-campaigns-chart";
import { PerformanceTrendChart } from "@/components/performance-trend-chart";
import {
  fetchPerfSummary,
  fetchPerfMonthStats,
  fetchPerfTopAgents,
  fetchPerfTopCampaigns,
  fetchPerfMonthlyTrend,
} from "@/lib/aggregations";
import { getLastSync } from "@/lib/filter-options";
import { fmtMoney, fmtNum } from "@/lib/utils";

export const dynamic = "force-dynamic";

function roasLabel(r: number) {
  return Number.isFinite(r) ? `${r.toFixed(2)}x` : "0.00x";
}

export default async function OverviewPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const currentMonthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  const [summary, monthStats, topAgents, topCampaigns, trend, lastSync] = await Promise.all([
    fetchPerfSummary(),
    fetchPerfMonthStats(year, month),
    fetchPerfTopAgents(year, month, 10),
    fetchPerfTopCampaigns(year, month, 8),
    fetchPerfMonthlyTrend(12),
    getLastSync(),
  ]);

  return (
    <>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-muted mt-0.5">
            Revenue = Net Commission · P&amp;L = Net Commission − Spend · ROAS = Revenue ÷ Spend
          </p>
        </div>
        <SyncButton lastSyncedAt={lastSync} />
      </div>

      {/* ── 1. All-Time Totals (4 hero cards) ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-400 ring-1 ring-indigo-500/20">
            ✨ All-Time Totals
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Total Spend"
            value={fmtMoney(summary.spend)}
            sub={`${fmtNum(summary.leads)} leads attributed`}
          />
          <KpiCard
            label="Total Revenue"
            value={fmtMoney(summary.revenue)}
            sub={`${fmtNum(summary.bookings)} bookings · Net Commission`}
          />
          <KpiCard
            label="Total P&L"
            value={fmtMoney(summary.pnl)}
            tone={summary.pnl >= 0 ? "good" : "bad"}
            sub="Revenue − Spend"
          />
          <KpiCard
            label="Total ROAS"
            value={roasLabel(summary.roas)}
            sub={`${(summary.roas * 100).toFixed(0)}% return on spend`}
          />
        </div>
      </section>

      {/* ── 2. Current Month Statistics ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20">
            📅 {currentMonthLabel}
          </span>
          <span className="text-xs text-muted">
            {fmtNum(monthStats.leads)} leads · {fmtNum(monthStats.bookings)} bookings
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Spend" value={fmtMoney(monthStats.spend)} sub="this month" />
          <KpiCard
            label="Non-Event Campaigns"
            value={fmtNum(monthStats.non_event_campaigns)}
            sub="active this month"
          />
          <KpiCard
            label="Event Campaigns"
            value={fmtNum(monthStats.event_campaigns)}
            sub="active this month"
          />
          <KpiCard
            label="Revenue"
            value={fmtMoney(monthStats.revenue)}
            sub="Net Commission"
          />
          <KpiCard
            label="P&L"
            value={fmtMoney(monthStats.pnl)}
            tone={monthStats.pnl >= 0 ? "good" : "bad"}
            sub="this month"
          />
          <KpiCard
            label="ROAS"
            value={roasLabel(monthStats.roas)}
            sub="this month"
          />
        </div>
      </section>

      {/* ── 3. KPI Charts (no tables) ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400 ring-1 ring-violet-500/20">
            🎯 KPIs · {currentMonthLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TopAgentsChart agents={topAgents} />
          <TopCampaignsChart campaigns={topCampaigns} />
        </div>

        <PerformanceTrendChart data={trend} />
      </section>
    </>
  );
}
