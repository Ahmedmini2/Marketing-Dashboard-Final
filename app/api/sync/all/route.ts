import { NextResponse } from "next/server";
import { syncMeta } from "@/lib/meta/sync";
import { syncSalesforce } from "@/lib/salesforce/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  const isCron = req.headers.get("authorization") === `Bearer ${process.env.SYNC_SECRET}`;
  if (!user && !isCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: job } = await admin
    .from("sync_jobs")
    .insert({ source: "all", user_id: user?.id ?? null })
    .select()
    .single();

  const errors: Record<string, string> = {};
  let metaStats: any = null;
  let sfStats: any = null;

  try { metaStats = await syncMeta(); }
  catch (e: any) { errors.meta = e?.message ?? String(e); }

  try { sfStats = await syncSalesforce(); }
  catch (e: any) { errors.salesforce = e?.message ?? String(e); }

  const ok = Object.keys(errors).length === 0;
  await admin
    .from("sync_jobs")
    .update({
      status: ok ? "success" : "error",
      finished_at: new Date().toISOString(),
      error: ok ? null : JSON.stringify(errors),
      stats: { meta: metaStats, salesforce: sfStats },
    })
    .eq("id", job!.id);

  return NextResponse.json({ ok, stats: { meta: metaStats, salesforce: sfStats }, errors });
}
