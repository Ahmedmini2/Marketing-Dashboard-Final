import { KpiCard } from "@/components/kpi-card";
import { SyncButton } from "@/components/sync-button";
import { DataTable, type Column } from "@/components/data-table";
import { fetchAccounts, fetchAccountCampaigns } from "@/lib/aggregations";
import { getLastSync } from "@/lib/filter-options";
import { fmtMoney, fmtNum } from "@/lib/utils";
import type { PerfAccountCampaign } from "@/lib/types";

export const dynamic = "force-dynamic";

function roasLabel(r: number) {
  return Number.isFinite(r) ? `${r.toFixed(2)}x` : "0.00x";
}

const campCols: Column<PerfAccountCampaign>[] = [
  { key: "campaign_name", header: "Campaign" },
  { key: "status",        header: "Status", fallback: "—" },
  { key: "spend",         header: "Spend",     align: "right", format: "money" },
  { key: "meta_leads",    header: "Meta Leads", align: "right", format: "num" },
  { key: "sf_leads",      header: "SF Leads",   align: "right", format: "num" },
  { key: "cpl",           header: "CPL",       align: "right", format: "money" },
  { key: "bookings",      header: "Bookings",  align: "right", format: "num" },
  { key: "revenue",       header: "Revenue",   align: "right", format: "money" },
  { key: "pnl",           header: "P&L",       align: "right", format: "money_pl" },
  { key: "roas",          header: "ROAS",      align: "right", format: "ratio_x" },
];

export default async function AccountsPage() {
  const [accounts, lastSync] = await Promise.all([fetchAccounts(), getLastSync()]);

  // Pull each accessible account's campaign breakdown in parallel.
  const campaignsByAccount = await Promise.all(
    accounts.map((a) => (a.accessible ? fetchAccountCampaigns(a.account_id) : Promise.resolve([]))),
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted mt-0.5">
            Spend, revenue &amp; P&amp;L per ad account · all-time · Revenue = Net Commission
          </p>
        </div>
        <SyncButton lastSyncedAt={lastSync} />
      </div>

      {accounts.length === 0 && (
        <div className="panel p-8 text-center text-muted">No ad accounts synced yet.</div>
      )}

      {accounts.map((a, i) => {
        const camps = campaignsByAccount[i];
        return (
          <section key={a.account_id} className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{a.account_name}</h2>
              <span className="text-xs rounded-full bg-white/5 px-2 py-0.5 text-muted ring-1 ring-border">
                {a.currency ?? "—"}
              </span>
              {!a.accessible && (
                <span className="text-xs rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400 ring-1 ring-amber-500/20">
                  Not accessible — grant token access &amp; re-sync
                </span>
              )}
              <span className="text-xs text-muted">{fmtNum(a.campaigns)} active campaigns</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard label="Spend" value={fmtMoney(a.spend)} />
              <KpiCard label="Revenue" value={fmtMoney(a.revenue)} sub="Net Commission" />
              <KpiCard label="P&L" value={fmtMoney(a.pnl)} tone={a.pnl >= 0 ? "good" : "bad"} />
              <KpiCard label="ROAS" value={roasLabel(a.roas)} />
              <KpiCard label="Leads" value={fmtNum(a.leads)} sub="Salesforce" />
              <KpiCard label="Bookings" value={fmtNum(a.bookings)} />
            </div>

            <DataTable
              rows={camps}
              columns={campCols}
              pageSize={10}
              empty={a.accessible ? "No campaign activity in this account." : "Account not yet synced."}
            />
          </section>
        );
      })}
    </>
  );
}
