import { FilterBar } from "@/components/filter-bar";
import { SyncButton } from "@/components/sync-button";
import { GroupedDataTable } from "@/components/grouped-data-table";
import { type Column } from "@/components/data-table";
import { fetchCampaigns, groupByMetaCampaign } from "@/lib/aggregations";
import { getLastSync, loadFilterOptions } from "@/lib/filter-options";
import { parseFilters, type SearchParams } from "@/lib/filters";
import type { CampaignRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const [forms, opts, lastSync] = await Promise.all([
    fetchCampaigns(filters),
    loadFilterOptions(),
    getLastSync(),
  ]);
  const groups = groupByMetaCampaign(forms);

  const cols: Column<CampaignRow>[] = [
    { key: "form_name", header: "Form Name" },
    { key: "currency",  header: "Cur.", fallback: "—" },
    { key: "leads",     header: "Leads",    align: "right", format: "num" },
    { key: "bookings",  header: "Bookings", align: "right", format: "num" },
    { key: "cpl",       header: "CPL",      align: "right", format: "money", currencyKey: "currency" },
    { key: "spend",     header: "Spend",    align: "right", format: "money", currencyKey: "currency" },
    { key: "revenue",   header: "Revenue",  align: "right", format: "money", currencyKey: "currency" },
    { key: "roas",      header: "ROAS",     align: "right", format: "ratio_x" },
    { key: "profit",    header: "P&L",      align: "right", format: "money_pl", currencyKey: "currency" },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <SyncButton lastSyncedAt={lastSync} />
      </div>
      <FilterBar campaigns={opts.campaigns} agents={opts.agents} teams={opts.teams} />
      <div className="text-xs text-muted">
        {groups.length} campaigns · {forms.length} forms
      </div>
      <GroupedDataTable
        groups={groups}
        columns={cols}
        parentLabelHeader="Campaign"
      />
    </>
  );
}
