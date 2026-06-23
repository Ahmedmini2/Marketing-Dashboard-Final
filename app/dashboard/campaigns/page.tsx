import { FilterBar } from "@/components/filter-bar";
import { SyncButton } from "@/components/sync-button";
import { DataTable, type Column } from "@/components/data-table";
import { fetchCampaignsAllDaily, fetchCampaignsAllMonthly } from "@/lib/aggregations";
import { getLastSync } from "@/lib/filter-options";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { todayISO } from "@/lib/utils";
import type { CampaignsAllRow } from "@/lib/types";

export const dynamic = "force-dynamic";

// Inside the 180d daily window → real day-precision spend. Outside → monthly.
const DAILY_WINDOW_DAYS = 180;

const cols: Column<CampaignsAllRow>[] = [
  { key: "account_name",  header: "Account" },
  { key: "campaign_name", header: "Campaign" },
  { key: "status",        header: "Status",     fallback: "—" },
  { key: "spend",         header: "Spend",      align: "right", format: "money" },
  { key: "meta_leads",    header: "Meta Leads", align: "right", format: "num" },
  { key: "sf_leads",      header: "SF Leads",   align: "right", format: "num" },
  { key: "cpl",           header: "CPL",        align: "right", format: "money" },
  { key: "bookings",      header: "Bookings",   align: "right", format: "num" },
  { key: "revenue",       header: "Revenue",    align: "right", format: "money" },
  { key: "pnl",           header: "P&L",        align: "right", format: "money_pl" },
  { key: "roas",          header: "ROAS",       align: "right", format: "ratio_x" },
];

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { range } = parseFilters(sp);
  const useDaily = range.from >= todayISO(-DAILY_WINDOW_DAYS);

  const [rows, lastSync] = await Promise.all([
    useDaily ? fetchCampaignsAllDaily(range.from, range.to) : fetchCampaignsAllMonthly(range),
    getLastSync(),
  ]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted mt-0.5">
            One row per Meta campaign · Revenue = Net Commission of marketing-attributed bookings
            {useDaily ? " · day-level" : " · month-level"}
          </p>
        </div>
        <SyncButton lastSyncedAt={lastSync} />
      </div>

      <FilterBar campaigns={[]} agents={[]} teams={[]} dateOnly />

      <div className="text-xs text-muted">{rows.length} campaigns with activity in this range</div>

      <DataTable rows={rows} columns={cols} pageSize={25} empty="No campaign activity in this range." />
    </>
  );
}
