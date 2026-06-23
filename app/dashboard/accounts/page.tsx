import { KpiCard } from "@/components/kpi-card";
import { SyncButton } from "@/components/sync-button";
import { FilterBar } from "@/components/filter-bar";
import { fetchAccounts, fetchAccountsDaily } from "@/lib/aggregations";
import { getLastSync } from "@/lib/filter-options";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { fmtMoney, fmtNum, todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

function roasLabel(r: number) {
  return Number.isFinite(r) ? `${r.toFixed(2)}x` : "0.00x";
}

// 180-day rolling daily window. Within it → use day-precision RPCs (real
// 7D/10D/14D spend). Outside it → fall back to the monthly-aligned RPCs.
const DAILY_WINDOW_DAYS = 180;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { range } = parseFilters(sp);
  const useDaily = range.from >= todayISO(-DAILY_WINDOW_DAYS);

  const [accounts, lastSync] = await Promise.all([
    useDaily ? fetchAccountsDaily(range.from, range.to) : fetchAccounts(range),
    getLastSync(),
  ]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted mt-0.5">
            Account-level Spend, Revenue &amp; P&amp;L · Revenue = Net Commission of marketing-attributed bookings
            {useDaily ? " · day-level" : " · month-level"} · per-campaign breakdown lives on the Campaigns tab
          </p>
        </div>
        <SyncButton lastSyncedAt={lastSync} />
      </div>

      <FilterBar campaigns={[]} agents={[]} teams={[]} dateOnly />

      {accounts.length === 0 && (
        <div className="panel p-8 text-center text-muted">No ad accounts synced yet.</div>
      )}

      {accounts.map((a) => (
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
            <span className="text-xs text-muted">{fmtNum(a.campaigns)} active campaigns in range</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Spend" value={fmtMoney(a.spend)} />
            <KpiCard label="Revenue" value={fmtMoney(a.revenue)} sub="Net Commission" />
            <KpiCard label="P&L" value={fmtMoney(a.pnl)} tone={a.pnl >= 0 ? "good" : "bad"} />
            <KpiCard label="ROAS" value={roasLabel(a.roas)} />
            <KpiCard label="Leads" value={fmtNum(a.leads)} sub="Salesforce" />
            <KpiCard label="Bookings" value={fmtNum(a.bookings)} />
          </div>
        </section>
      ))}
    </>
  );
}
