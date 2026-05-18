import { supabaseAdmin } from "@/lib/supabase/admin";

export async function loadFilterOptions() {
  const db = supabaseAdmin();
  const [forms, agents, teams] = await Promise.all([
    db.from("meta_lead_forms").select("id,name").order("name").limit(500),
    db.from("sf_agents").select("id,name").order("name").limit(500),
    db.from("sf_teams").select("id,name").order("name").limit(500),
  ]);
  return {
    campaigns: forms.data ?? [],
    agents: agents.data ?? [],
    teams: teams.data ?? [],
  };
}

export async function getLastSync(): Promise<string | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("sync_jobs")
    .select("finished_at")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.finished_at ?? null;
}
