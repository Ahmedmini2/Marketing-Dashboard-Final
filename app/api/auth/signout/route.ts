import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supa = await supabaseServer();
  await supa.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url));
}
