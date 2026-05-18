import { FilterBar } from "@/components/filter-bar";
import { SyncButton } from "@/components/sync-button";
import { DataTable, type Column } from "@/components/data-table";
import { fetchAgents, byTeam } from "@/lib/aggregations";
import { getLastSync, loadFilterOptions } from "@/lib/filter-options";
import { parseFilters, type SearchParams } from "@/lib/filters";
import type { AgentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TeamsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const [agents, opts, lastSync] = await Promise.all([
    fetchAgents(filters),
    loadFilterOptions(),
    getLastSync(),
  ]);
  const data = byTeam(agents);

  const cols: Column<AgentRow>[] = [
    { key: "team_name", header: "Team" },
    { key: "leads",     header: "Leads",    align: "right", format: "num" },
    { key: "bookings",  header: "Bookings", align: "right", format: "num" },
    { key: "spend",     header: "Spend",    align: "right", format: "money" },
    { key: "revenue",   header: "Revenue",  align: "right", format: "money" },
    { key: "roas",      header: "ROAS",     align: "right", format: "ratio_x" },
    { key: "profit",    header: "P&L",      align: "right", format: "money_pl" },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Teams</h1>
        <SyncButton lastSyncedAt={lastSync} />
      </div>
      <FilterBar campaigns={opts.campaigns} agents={opts.agents} teams={opts.teams} />
      <DataTable rows={data} columns={cols} />
    </>
  );
}
