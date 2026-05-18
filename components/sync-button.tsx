"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function SyncButton({ lastSyncedAt }: { lastSyncedAt?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Render formatted timestamp only after mount — toLocaleString() differs
  // between the SSR server's locale/tz and the user's browser.
  const [lastSyncDisplay, setLastSyncDisplay] = useState<string | null>(null);
  useEffect(() => {
    if (lastSyncedAt) setLastSyncDisplay(new Date(lastSyncedAt).toLocaleString());
  }, [lastSyncedAt]);

  async function run() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/sync/all", { method: "POST" });
      const body = await r.json();
      if (!body.ok) {
        setMsg("Some sources failed — see Integrations.");
      } else {
        setMsg("Synced.");
      }
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {lastSyncDisplay && (
        <span className="text-xs text-muted" suppressHydrationWarning>
          Last sync: {lastSyncDisplay}
        </span>
      )}
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <button className="btn btn-primary" onClick={run} disabled={busy}>
        <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
