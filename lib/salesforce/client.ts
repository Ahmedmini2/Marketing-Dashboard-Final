import { Connection, OAuth2 } from "jsforce";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Build a jsforce Connection from the most recently saved Salesforce connection
 * row in Supabase. Uses the access token, falling back to refresh-token flow if
 * the access token has expired.
 */
export async function sfConnection(): Promise<Connection> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("salesforce_connections")
    .select("*")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No Salesforce connection on file. Connect Salesforce first.");

  const conn = new Connection({
    oauth2: sfOAuth2(),
    instanceUrl: data.instance_url,
    accessToken: data.access_token ?? undefined,
    refreshToken: data.refresh_token ?? undefined,
  });

  conn.on("refresh", async (newAccessToken: string) => {
    await db
      .from("salesforce_connections")
      .update({ access_token: newAccessToken })
      .eq("id", data.id);
  });

  return conn;
}

export function sfOAuth2() {
  // Strip trailing slashes — jsforce appends "/services/oauth2/..." and
  // a trailing "/" produces "//services/oauth2/..." which some SF tenants reject.
  const loginUrl = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, "");
  return new OAuth2({
    loginUrl,
    clientId: process.env.SF_CLIENT_ID!,
    clientSecret: process.env.SF_CLIENT_SECRET!,
    redirectUri: process.env.SF_CALLBACK_URL!,
  });
}
