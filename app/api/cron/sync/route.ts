import { NextResponse } from "next/server";
import { startSyncAll } from "@/lib/sync/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled-sync entrypoint (Vercel cron, Supabase pg_cron, or any external
 * scheduler hitting this with `Authorization: Bearer $SYNC_SECRET`).
 *
 * Starts the sync and returns the job id immediately — it does NOT wait for the
 * ~12-minute run to finish, so schedulers with short HTTP timeouts won't record
 * a failure for a sync that is in fact progressing. Poll
 * GET /api/sync/status?id=<jobId> for the outcome.
 *
 * This calls the runner directly rather than looping back through
 * POST /api/sync/all: the extra internal request bought nothing and gave the
 * proxy another chance to mangle the response.
 */
export async function GET(req: Request) {
  const expected = process.env.SYNC_SECRET;
  if (!expected) return NextResponse.json({ error: "SYNC_SECRET not set" }, { status: 500 });

  const auth = req.headers.get("authorization");
  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>` — accept either.
  const fromVercel = req.headers.get("x-vercel-cron") === "1";
  if (!fromVercel && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { jobId, alreadyRunning } = await startSyncAll(null);
    return NextResponse.json(
      { ok: true, jobId, status: "running", alreadyRunning },
      { status: 202 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
