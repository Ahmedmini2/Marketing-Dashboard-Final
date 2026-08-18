import { NextResponse } from "next/server";
import { getActiveJob, getJob, getLatestJob, type SyncJob } from "@/lib/sync/runner";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `error` holds a JSON map of per-source messages for 'all' jobs, plain text otherwise. */
function parseErrors(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { sync: raw };
  } catch {
    return { sync: raw };
  }
}

function shape(job: SyncJob) {
  const started = job.started_at ? Date.parse(job.started_at) : null;
  const ended = job.finished_at ? Date.parse(job.finished_at) : Date.now();
  return {
    jobId: job.id,
    status: job.status,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    elapsedSeconds: started ? Math.max(0, Math.round((ended - started) / 1000)) : null,
    stats: job.stats,
    errors: parseErrors(job.error),
  };
}

/**
 * Poll a sync's progress.
 *
 * GET /api/sync/status            → the running job, else the most recent one
 * GET /api/sync/status?id=<uuid>  → that specific job
 *
 * Jobs whose runner died (container restart / redeploy mid-sync) are swept to
 * status 'error' before reading, so this never reports a phantom 'running'.
 */
export async function GET(req: Request) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  const isCron = req.headers.get("authorization") === `Bearer ${process.env.SYNC_SECRET}`;
  if (!user && !isCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  const job = id ? await getJob(id) : ((await getActiveJob()) ?? (await getLatestJob()));

  if (!job) return NextResponse.json({ ok: true, job: null });
  return NextResponse.json({ ok: true, job: shape(job) });
}
