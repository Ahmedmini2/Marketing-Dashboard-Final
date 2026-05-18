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
