import { FilterBar } from "@/components/filter-bar";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/trend-chart";
import { SyncButton } from "@/components/sync-button";
import { GroupedDataTable } from "@/components/grouped-data-table";
import { type Column } from "@/components/data-table";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { fetchCampaigns, fetchKpi, groupByMetaCampaign } from "@/lib/aggregations";
import { getLastSync, loadFilterOptions } from "@/lib/filter-options";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/utils";
import type { CampaignRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const [kpi, forms, opts, lastSync] = await Promise.all([
    fetchKpi(filters),
    fetchCampaigns(filters),
    loadFilterOptions(),
    getLastSync(),
  ]);

  const k = kpi.summary;
  const groups = groupByMetaCampaign(forms).slice(0, 8);

  const cols: Column<CampaignRow>[] = [
    { key: "form_name",     header: "Form Name" },
    { key: "leads",         header: "Leads",    align: "right", format: "num" },
    { key: "bookings",      header: "Bookings", align: "right", format: "num" },
    { key: "spend",         header: "Spend",    align: "right", format: "money",    currencyKey: "currency" },
    { key: "revenue",       header: "Revenue",  align: "right", format: "money",    currencyKey: "currency" },
    { key: "profit",        header: "P&L",      align: "right", format: "money_pl", currencyKey: "currency" },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-muted">Revenue & P&L across Meta spend and Salesforce outcomes.</p>
        </div>
        <SyncButton lastSyncedAt={lastSync} />
      </div>

      <FilterBar campaigns={opts.campaigns} agents={opts.agents} teams={opts.teams} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Spend" value={fmtMoney(k.spend)} sub="Attributed from Meta (AED)" />
        <KpiCard label="Revenue" value={fmtMoney(k.revenue)} sub={`${fmtNum(k.bookings)} bookings`} />
        <KpiCard label="Profit / Loss" value={fmtMoney(k.profit)} tone={k.profit >= 0 ? "good" : "bad"} sub={fmtPct(k.margin) + " margin"} />
        <KpiCard label="ROAS" value={k.roas.toFixed(2) + "x"} sub={`${fmtMoney(k.cpl)} CPL · ${fmtNum(k.leads)} leads`} />
      </div>

      <TrendChart data={kpi.trend} />

      <div>
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Top campaigns</h2>
        <GroupedDataTable groups={groups} columns={cols} parentLabelHeader="Campaign" pageSize={8} />
      </div>
    </>
  );
}
