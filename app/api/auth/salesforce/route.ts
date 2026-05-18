import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const base64url = (buf: Buffer) =>
  buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

// Build the Salesforce authorize URL ourselves so we have direct control over
// the PKCE params. jsforce v3's typings don't reliably expose code_challenge.
export async function GET() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());

  const loginUrl = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, "");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.SF_CLIENT_ID!,
    redirect_uri: process.env.SF_CALLBACK_URL!,
    scope: "api refresh_token offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const url = `${loginUrl}/services/oauth2/authorize?${params.toString()}`;

  const res = NextResponse.redirect(url);
  res.cookies.set("sf_pkce", verifier, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
