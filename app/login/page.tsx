"use client";

import { Suspense, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const supa = supabaseBrowser();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const fn = mode === "signin"
      ? supa.auth.signInWithPassword({ email, password })
      : supa.auth.signUp({ email, password });
    const { error } = await fn;
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Marketing Dashboard</h1>
          <p className="text-sm text-muted">{mode === "signin" ? "Sign in" : "Create your account"}</p>
        </div>
        <input className="input w-full" type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} />
        <input className="input w-full" type="password" placeholder="Password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="text-bad text-sm">{error}</p>}
        <button className="btn btn-primary w-full justify-center" disabled={busy}>
          {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button type="button" className="text-sm text-muted hover:text-text" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
