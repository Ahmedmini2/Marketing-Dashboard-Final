import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SyncButton } from "@/components/sync-button";
import { getLastSync } from "@/lib/filter-options";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const db = supabaseAdmin();
  const [{ data: metaAccts }, { data: sfConn }, { data: jobs }, lastSync] = await Promise.all([
    db.from("meta_ad_accounts").select("*").order("connected_at", { ascending: false }),
    db.from("salesforce_connections").select("*").order("connected_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("sync_jobs").select("*").order("started_at", { ascending: false }).limit(10),
    getLastSync(),
  ]);

  const metaConfigured = !!process.env.META_ACCESS_TOKEN;

  // Per-source problems live inside sync_jobs.stats, where they used to be
  // invisible: a sync that skips a broken record or a rate-limited ad account
  // still finishes 'success', and the Detail column truncates the stats JSON.
  // Surface them explicitly so a partial sync is noticed without reading blobs.
  const latestWithStats = (jobs ?? []).find((j: any) => j.stats);
  const rejectedBookings: Array<{ id: string; field: string; value: string }> =
    latestWithStats?.stats?.salesforce?.rejected_bookings ?? [];
  const metaAccountErrors: Array<[string, string]> = Object.entries(
    (latestWithStats?.stats?.meta?.account_errors ?? {}) as Record<string, string>
  );
  const hasWarnings = rejectedBookings.length > 0 || metaAccountErrors.length > 0;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <SyncButton lastSyncedAt={lastSync} />
      </div>

      {/* META --------------------------------------------------------- */}
      <section className="panel p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Meta (Facebook Ads)</h2>
            <p className="text-sm text-muted">
              Configured via env vars. {metaConfigured ? "Token detected." : "Set META_ACCESS_TOKEN in .env."}
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded ${metaConfigured ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
            {metaConfigured ? "Connected" : "Not configured"}
          </span>
        </div>
        <div className="text-sm">
          <div className="text-muted mb-1">Synced ad accounts:</div>
          {metaAccts && metaAccts.length > 0 ? (
            <ul className="space-y-1">
              {metaAccts.map((a) => (
                <li key={a.id} className="flex justify-between">
                  <span>{a.name || a.id}</span>
                  <span className="text-muted">{a.last_synced_at ? new Date(a.last_synced_at).toLocaleString() : "—"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted">No accounts synced yet. Click <em>Sync now</em>.</div>
          )}
        </div>
      </section>

      {/* SALESFORCE --------------------------------------------------- */}
      <section className="panel p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Salesforce</h2>
            <p className="text-sm text-muted">
              OAuth Web-Server flow. Connect your org to start syncing leads + bookings.
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded ${sfConn ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
            {sfConn ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="flex gap-3">
          <Link href="/api/auth/salesforce" className="btn btn-primary">
            {sfConn ? "Reconnect Salesforce" : "Connect Salesforce"}
          </Link>
          {sfConn && (
            <span className="text-sm text-muted self-center">
              {sfConn.instance_url} · last sync {sfConn.last_synced_at ? new Date(sfConn.last_synced_at).toLocaleString() : "—"}
            </span>
          )}
        </div>
      </section>

      {/* DATA WARNINGS ------------------------------------------------ */}
      {hasWarnings && (
        <section className="panel p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Data warnings</h2>
            <span className="text-xs px-2 py-1 rounded bg-bad/15 text-bad">
              from the last sync
            </span>
          </div>

          {rejectedBookings.length > 0 && (
            <div className="text-sm space-y-1">
              <div className="text-muted">
                {rejectedBookings.length} booking{rejectedBookings.length === 1 ? "" : "s"} skipped —
                the value is too large for the dashboard to store and needs fixing in Salesforce:
              </div>
              <ul className="space-y-1">
                {rejectedBookings.map((b) => (
                  <li key={`${b.id}-${b.field}`} className="flex justify-between gap-4">
                    <span className="font-mono text-xs">{b.id}</span>
                    <span className="text-muted truncate">
                      {b.field} = {b.value}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {metaAccountErrors.length > 0 && (
            <div className="text-sm space-y-1">
              <div className="text-muted">
                {metaAccountErrors.length} Meta ad account
                {metaAccountErrors.length === 1 ? "" : "s"} did not sync:
              </div>
              <ul className="space-y-1">
                {metaAccountErrors.map(([acct, message]) => (
                  <li key={acct} className="flex justify-between gap-4">
                    <span className="font-mono text-xs">{acct}</span>
                    <span className="text-muted truncate">{message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* SYNC HISTORY ------------------------------------------------- */}
      <section className="panel p-5">
        <h2 className="font-semibold mb-3">Recent sync jobs</h2>
        <table className="tbl">
          <thead>
            <tr><th>Started</th><th>Source</th><th>Status</th><th>Finished</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((j: any) => (
              <tr key={j.id}>
                <td>{new Date(j.started_at).toLocaleString()}</td>
                <td>{j.source}</td>
                <td className={j.status === "success" ? "text-good" : j.status === "error" ? "text-bad" : ""}>{j.status}</td>
                <td>{j.finished_at ? new Date(j.finished_at).toLocaleString() : "—"}</td>
                <td className="text-muted truncate max-w-[400px]">{j.error ?? (j.stats ? JSON.stringify(j.stats) : "")}</td>
              </tr>
            ))}
            {(!jobs || jobs.length === 0) && (
              <tr><td colSpan={5} className="text-center text-muted py-6">No sync jobs yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
