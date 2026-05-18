import { NextResponse } from "next/server";
import { syncSalesforce } from "@/lib/salesforce/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  const isCron = req.headers.get("authorization") === `Bearer ${process.env.SYNC_SECRET}`;
  if (!user && !isCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: job } = await admin
    .from("sync_jobs")
    .insert({ source: "salesforce", user_id: user?.id ?? null })
    .select()
    .single();

  try {
    const stats = await syncSalesforce();
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
