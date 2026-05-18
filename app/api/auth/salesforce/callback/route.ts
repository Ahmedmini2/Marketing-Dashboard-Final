import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { syncSalesforce } from "@/lib/salesforce/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) {
    const desc = url.searchParams.get("error_description") || "missing code";
    return NextResponse.json({ error: decodeURIComponent(desc) }, { status: 400 });
  }

  // Read the PKCE verifier we set on the cookie at /api/auth/salesforce.
  const cookieHeader = req.headers.get("cookie") || "";
  const verifier = cookieHeader
    .split(/;\s*/)
    .find((p) => p.startsWith("sf_pkce="))
    ?.slice("sf_pkce=".length);

  const loginUrl = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, "");

  // Exchange the code for tokens directly via the Salesforce token endpoint.
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.SF_CLIENT_ID!,
    client_secret: process.env.SF_CLIENT_SECRET!,
    redirect_uri: process.env.SF_CALLBACK_URL!,
  });
  if (verifier) body.append("code_verifier", verifier);

  const tokenRes = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok) {
    return NextResponse.json({ step: "token-exchange", error: token }, { status: 400 });
  }

  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();

  const admin = supabaseAdmin();
  await admin.from("salesforce_connections").insert({
    user_id: user?.id ?? null,
    instance_url: token.instance_url,
    access_token: token.access_token,
    refresh_token: token.refresh_token ?? null,
  });

  // Auto-sync immediately so the dashboard has data without a manual click.
  // Logged to sync_jobs so failures surface in the Integrations page.
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
  } catch (e: any) {
    await admin
      .from("sync_jobs")
      .update({ status: "error", finished_at: new Date().toISOString(), error: e?.message ?? String(e) })
      .eq("id", job!.id);
  }

  const res = NextResponse.redirect(new URL("/dashboard/settings/integrations?sf=connected", url));
  res.cookies.delete("sf_pkce");
  return res;
}
