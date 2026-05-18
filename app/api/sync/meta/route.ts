import { NextResponse } from "next/server";
import { syncMeta } from "@/lib/meta/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();

  // Allow cron-triggered calls if SYNC_SECRET matches.
  const auth = req.headers.get("authorization");
  const isCron = auth && auth === `Bearer ${process.env.SYNC_SECRET}`;
  if (!user && !isCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? undefined;
  const until = url.searchParams.get("until") ?? undefined;

  const admin = supabaseAdmin();
  const { data: job } = await admin
    .from("sync_jobs")
    .insert({ source: "meta", user_id: user?.id ?? null })
    .select()
    .single();

  try {
    const stats = await syncMeta({ since, until });
    await admin
      .from("sync_jobs")
      .update({ status: "success", finished_at: new Date().toISOString(), stats })
      .eq("id", job!.id);
    return NextResponse.json({ ok: true, stats });
  } catch (e: any) {
    await admin
      .from("sync_jobs")
      .update({ status: "error", finished_at: new Date().toISOString(), error: e?.message ?? String(e) })
      .eq("id", job!.id);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
