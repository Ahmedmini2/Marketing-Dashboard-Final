import LoginClient from "./login-client";

// Server-component wrapper so this segment config is honoured. Skipping static
// prerender is required because supabaseBrowser() needs NEXT_PUBLIC_SUPABASE_*
// env vars that aren't injected at build time on hosts like Railway.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginClient />;
}
