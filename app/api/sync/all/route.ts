import { NextResponse } from "next/server";
import { startSyncAll } from "@/lib/sync/runner";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NOTE: `maxDuration` used to be set here. It is a Vercel-only export and had
// no effect on Railway, and at 300s it was below this sync's measured 539s
// floor anyway. The handler now returns in milliseconds, so it is moot.

/**
 * Kick off a full Meta + Salesforce sync.
 *
 * Responds 202 immediately with a job id; the sync itself runs in the
 * background (see lib/sync/runner.ts for why) and the client polls
 * GET /api/sync/status?id=<jobId> for the outcome.
 *
 * If a sync is already in flight, this joins it rather than starting a second
 * one — concurrent syncs used to rate-limit each other on the Meta API.
 */
export async function POST(req: Request) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  const isCron = req.headers.get("authorization") === `Bearer ${process.env.SYNC_SECRET}`;
  if (!user && !isCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { jobId, alreadyRunning } = await startSyncAll(user?.id ?? null);
    return NextResponse.json(
      { ok: true, jobId, status: "running", alreadyRunning },
      { status: 202 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
