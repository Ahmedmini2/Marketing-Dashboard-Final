import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncMeta } from "@/lib/meta/sync";
import { syncSalesforce } from "@/lib/salesforce/sync";

/**
 * Background runner for the full Meta + Salesforce sync.
 *
 * Why this exists: a full sync takes 9–17 minutes (measured across 20+ runs in
 * sync_jobs). It used to be awaited inside POST /api/sync/all, so Railway's
 * edge proxy tore down the client connection minutes before the work finished
 * and answered with the plaintext body `upstream error`. The container carried
 * on syncing regardless — the data was always fine — but the browser saw a
 * dead request and reported it as a failure, which prompted repeat clicks and
 * overlapping syncs that rate-limited each other on the Meta API.
 *
 * So: the request only *starts* the work and returns a job id. The sync runs
 * detached on the container's event loop (safe here — Railway keeps the Node
 * process alive between requests, unlike a serverless function) and reports
 * progress through sync_jobs, which the UI polls.
 */

/** How often the runner stamps heartbeat_at while working. */
const HEARTBEAT_MS = 15_000;

/**
 * A job whose heartbeat is older than this is considered dead. Must exceed
 * HEARTBEAT_MS by a wide margin: a single Meta call can block for up to 120s
 * during rate-limit backoff, and the heartbeat timer only fires between awaits.
 */
export const STALE_AFTER = "5 minutes";

export type SyncJob = {
  id: string;
  source: string;
  status: "running" | "success" | "error";
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  error: string | null;
  stats: unknown;
};

/**
 * In-process guard against two near-simultaneous requests both passing the
 * database check below and starting duplicate syncs. The DB check is the real
 * safety net (it also covers cron and any second replica); this just closes
 * the millisecond-wide window for the common case of an impatient double-click.
 */
let inFlight: string | null = null;

/** Close out jobs whose runner died — a redeploy mid-sync leaves them at 'running'. */
export async function sweepStaleJobs(): Promise<number> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("sweep_stale_sync_jobs", { p_stale_after: STALE_AFTER });
  if (error) {
    console.warn("[sync] sweep_stale_sync_jobs failed (non-fatal):", error.message);
    return 0;
  }
  return (data as number) ?? 0;
}

/** The currently-running job, if one is genuinely alive (fresh heartbeat). */
export async function getActiveJob(): Promise<SyncJob | null> {
  await sweepStaleJobs();
  const db = supabaseAdmin();
  const { data } = await db
    .from("sync_jobs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SyncJob) ?? null;
}

export async function getJob(id: string): Promise<SyncJob | null> {
  await sweepStaleJobs();
  const db = supabaseAdmin();
  const { data } = await db.from("sync_jobs").select("*").eq("id", id).maybeSingle();
  return (data as SyncJob) ?? null;
}

/** Most recent job of any status — used to restore the UI on page load. */
export async function getLatestJob(): Promise<SyncJob | null> {
  await sweepStaleJobs();
  const db = supabaseAdmin();
  const { data } = await db
    .from("sync_jobs")
    .select("*")
    .eq("source", "all")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SyncJob) ?? null;
}

/**
 * Start a full sync unless one is already running.
 *
 * Returns as soon as the job row exists — the sync itself continues in the
 * background. `alreadyRunning` tells the caller it joined an existing run
 * rather than starting a new one.
 */
export async function startSyncAll(
  userId: string | null
): Promise<{ jobId: string; alreadyRunning: boolean }> {
  const existing = await getActiveJob();
  if (existing) return { jobId: existing.id, alreadyRunning: true };
  if (inFlight) return { jobId: inFlight, alreadyRunning: true };

  const db = supabaseAdmin();
  const { data: job, error } = await db
    .from("sync_jobs")
    .insert({ source: "all", user_id: userId, heartbeat_at: new Date().toISOString() })
    .select()
    .single();

  // Previously this was `job!.id` — a failed insert (RLS, connectivity) threw a
  // TypeError that the caller reported as an opaque 500.
  if (error || !job) {
    throw new Error(`could not create sync job: ${error?.message ?? "no row returned"}`);
  }

  inFlight = job.id;
  // Deliberately not awaited: the HTTP response must not wait for this.
  void runJob(job.id).finally(() => {
    if (inFlight === job.id) inFlight = null;
  });

  return { jobId: job.id, alreadyRunning: false };
}

/** Runs both syncs to completion and writes the terminal status. Never throws. */
async function runJob(jobId: string): Promise<void> {
  const db = supabaseAdmin();

  const beat = setInterval(() => {
    void db
      .from("sync_jobs")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(({ error }) => {
        if (error) console.warn("[sync] heartbeat failed:", error.message);
      });
  }, HEARTBEAT_MS);
  // Don't hold the process open just for the heartbeat timer.
  if (typeof beat.unref === "function") beat.unref();

  const errors: Record<string, string> = {};
  let metaStats: unknown = null;
  let sfStats: unknown = null;

  try {
    try {
      metaStats = await syncMeta();
    } catch (e: any) {
      errors.meta = e?.message ?? String(e);
      console.error("[sync] meta failed:", e);
    }

    try {
      sfStats = await syncSalesforce();
    } catch (e: any) {
      errors.salesforce = e?.message ?? String(e);
      console.error("[sync] salesforce failed:", e);
    }
  } finally {
    clearInterval(beat);
  }

  const ok = Object.keys(errors).length === 0;
  const { error: updateError } = await db
    .from("sync_jobs")
    .update({
      status: ok ? "success" : "error",
      finished_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      error: ok ? null : JSON.stringify(errors),
      stats: { meta: metaStats, salesforce: sfStats },
    })
    .eq("id", jobId);

  // If this write fails the row stays 'running' and sweep_stale_sync_jobs will
  // close it out five minutes later, so log loudly but don't rethrow — there is
  // no request left to surface an exception to.
  if (updateError) {
    console.error("[sync] could not write terminal status for", jobId, updateError.message);
  }
}
