import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel cron / Supabase pg_cron entrypoint.
 * Hits /api/sync/all with the SYNC_SECRET header so it bypasses auth.
 * Schedule (vercel.json): { "crons": [{ "path": "/api/cron/sync", "schedule": "0 H/6 * * *" }] }
 * (replace H with star — escaping star-slash inside a block comment)
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

  const url = new URL("/api/sync/all", req.url);
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${expected}` },
  });
  const body = await r.json().catch(() => ({}));
  return NextResponse.json(body, { status: r.status });
}
