import { GroupedDataTable } from "@/components/grouped-data-table";
import { FilterBar } from "@/components/filter-bar";
import { SyncButton } from "@/components/sync-button";
import { type Column } from "@/components/data-table";
import { fetchPerformance } from "@/lib/aggregations";
import { getLastSync } from "@/lib/filter-options";
import { parseFilters, type SearchParams } from "@/lib/filters";
import type { PerformanceRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const cols: Column<PerformanceRow>[] = [
  { key: "label",            header: "Month / Campaign",  sortable: false },
  { key: "spend",            header: "Amount Spent",       align: "right", format: "money" },
  { key: "leads",            header: "Leads",              align: "right", format: "num" },
  { key: "cpl",              header: "CPL",                align: "right", format: "money" },
  { key: "unit_price",       header: "Unit Price",         align: "right", format: "money" },
  { key: "gross_commission", header: "Gross Commission",   align: "right", format: "money" },
  { key: "net_commission",   header: "Net Commission",     align: "right", format: "money" },
  { key: "pnl",              header: "P&L",                align: "right", format: "money_pl" },
  { key: "roi",              header: "ROI",                align: "right", format: "pct" },
];

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const [{ eventGroups, nonEventGroups }, lastSync] = await Promise.all([
    fetchPerformance(filters.range),
    getLastSync(),
  ]);

  const totalEventMonths    = eventGroups.length;
  const totalNonEventMonths = nonEventGroups.length;

  return (
    <>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-muted mt-0.5">
            Monthly breakdown by event type · P&amp;L = Net Commission − Spend ·
            ROI = P&amp;L ÷ Spend
          </p>
        </div>
        <SyncButton lastSyncedAt={lastSync} />
      </div>

      {/* ── Date filter — campaign/agent/team dropdowns hidden (not applicable here) ── */}
      <FilterBar campaigns={[]} agents={[]} teams={[]} />

      {/* ── Event Campaigns ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20">
            🎯 Event Campaigns
          </span>
          <span className="text-xs text-muted">
            {totalEventMonths} month{totalEventMonths !== 1 ? "s" : ""}
          </span>
        </div>
        <GroupedDataTable
          groups={eventGroups}
          columns={cols}
          parentLabelHeader="Month"
          childLabel="campaign"
          empty="No event campaigns in this date range."
        />
      </section>

      {/* ── Non-Event Campaigns ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400 ring-1 ring-violet-500/20">
            📋 Non-Event Campaigns
          </span>
          <span className="text-xs text-muted">
            {totalNonEventMonths} month{totalNonEventMonths !== 1 ? "s" : ""}
          </span>
        </div>
        <GroupedDataTable
          groups={nonEventGroups}
          columns={cols}
          parentLabelHeader="Month"
          childLabel="campaign"
          empty="No non-event campaigns in this date range."
        />
      </section>
    </>
  );
}
