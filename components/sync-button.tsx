"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type JobStatus = "running" | "success" | "error";
type Job = {
  jobId: string;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedSeconds: number | null;
  stats: unknown;
  errors: Record<string, string> | null;
};

const POLL_MS = 5_000;
/** Longest a sync has ever taken is ~17 min; give up polling well past that. */
const POLL_TIMEOUT_MS = 45 * 60_000;

/**
 * Read a JSON response without assuming the body *is* JSON.
 *
 * Railway's edge proxy answers with the plaintext body `upstream error` when it
 * can't reach the container. Calling r.json() on that threw
 * "Unexpected token 'u', "upstream error" is not valid JSON", which the old
 * catch block rendered verbatim as the sync status — a parser complaint shown
 * where an infrastructure error belonged.
 */
async function readJson(r: Response): Promise<{ data: any; error: string | null }> {
  const text = await r.text().catch(() => "");
  const looksJson = (r.headers.get("content-type") ?? "").includes("application/json");

  if (looksJson) {
    try {
      return { data: JSON.parse(text), error: null };
    } catch {
      /* fall through to the non-JSON handling below */
    }
  }

  const snippet = text.trim().slice(0, 120);
  if (!r.ok) {
    return { data: null, error: `Server returned ${r.status}${snippet ? ` — ${snippet}` : ""}` };
  }
  return { data: null, error: snippet || "Server returned an unreadable response" };
}

function describe(job: Job): string {
  if (job.status === "success") return "Synced.";
  const sources = Object.keys(job.errors ?? {});
  if (!sources.length) return "Sync failed — see Integrations.";
  return `${sources.join(" and ")} failed — see Integrations.`;
}

function elapsedLabel(seconds: number | null): string {
  if (seconds == null) return "Syncing…";
  const m = Math.floor(seconds / 60);
  return m < 1 ? "Syncing…" : `Syncing… ${m}m`;
}

export function SyncButton({ lastSyncedAt }: { lastSyncedAt?: string | null }) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Render formatted timestamp only after mount — toLocaleString() differs
  // between the SSR server's locale/tz and the user's browser.
  const [lastSyncDisplay, setLastSyncDisplay] = useState<string | null>(null);
  useEffect(() => {
    if (lastSyncedAt) setLastSyncDisplay(new Date(lastSyncedAt).toLocaleString());
  }, [lastSyncedAt]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /**
   * Poll until the job reaches a terminal status. A sync outlives any single
   * request, so progress is read from sync_jobs rather than from the response
   * to the request that started it.
   */
  const poll = useCallback(
    async (jobId: string, deadline: number) => {
      if (!alive.current) return;

      try {
        const r = await fetch(`/api/sync/status?id=${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        const { data, error } = await readJson(r);
        if (!alive.current) return;

        if (error) {
          // A blip while polling doesn't mean the sync died — it runs on the
          // server independently of this page. Keep trying until the deadline.
          if (Date.now() < deadline) {
            timer.current = setTimeout(() => void poll(jobId, deadline), POLL_MS);
          } else {
            setJob(null);
            setMsg("Lost track of the sync — reload to check Integrations.");
          }
          return;
        }

        const next: Job | null = data?.job ?? null;
        if (!next) {
          setJob(null);
          setMsg("Sync job not found.");
          return;
        }

        setJob(next);

        if (next.status === "running") {
          if (Date.now() < deadline) {
            timer.current = setTimeout(() => void poll(jobId, deadline), POLL_MS);
          } else {
            setMsg("Still syncing — check Integrations for the result.");
            setJob(null);
          }
          return;
        }

        setMsg(describe(next));
        setJob(null);
        router.refresh();
      } catch {
        if (!alive.current) return;
        if (Date.now() < deadline) {
          timer.current = setTimeout(() => void poll(jobId, deadline), POLL_MS);
        }
      }
    },
    [router]
  );

  // A sync survives a page reload, so pick up any run already in flight.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/sync/status", { cache: "no-store" });
        const { data, error } = await readJson(r);
        if (cancelled || error) return;
        const existing: Job | null = data?.job ?? null;
        if (existing?.status === "running") {
          setJob(existing);
          void poll(existing.jobId, Date.now() + POLL_TIMEOUT_MS);
        }
      } catch {
        /* nothing in flight we can see — leave the button idle */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poll]);

  async function run() {
    setStarting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/sync/all", { method: "POST" });
      const { data, error } = await readJson(r);

      if (error) {
        setMsg(error);
        return;
      }
      if (!data?.ok || !data?.jobId) {
        setMsg(data?.error ?? "Could not start the sync.");
        return;
      }

      setJob({
        jobId: data.jobId,
        status: "running",
        startedAt: null,
        finishedAt: null,
        elapsedSeconds: 0,
        stats: null,
        errors: null,
      });
      if (data.alreadyRunning) setMsg("A sync was already running — following it.");
      void poll(data.jobId, Date.now() + POLL_TIMEOUT_MS);
    } catch (e: any) {
      setMsg(e?.message ?? "Sync failed to start");
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || job?.status === "running";

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
        {busy ? elapsedLabel(job?.elapsedSeconds ?? null) : "Sync now"}
      </button>
    </div>
  );
}
