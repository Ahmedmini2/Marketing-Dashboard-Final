import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AgentRow, CampaignRow, DateRange, KpiSummary } from "@/lib/types";
import type { SortKey } from "@/lib/filters";

type Filters = {
  range: DateRange;
  campaignId?: string;
  agentId?: string;
  teamId?: string;
};

/**
 * Server-side aggregation. Pages call these three RPCs (one HTTP round trip
 * each) instead of pulling every lead row to the app and aggregating in JS.
 *
 *   dashboard_campaigns → per-form rows
 *   dashboard_agents    → per-agent rows
 *   dashboard_kpi       → KPI summary + daily trend
 *
 * Each accepts the same date + campaign/agent/team filters.
 */
function rpcParams(opts: Filters) {
  return {
    p_from: opts.range.from,
    p_to: `${opts.range.to}T23:59:59.999Z`,
    p_campaign_id: opts.campaignId ?? null,
    p_agent_id: opts.agentId ?? null,
    p_team_id: opts.teamId ?? null,
  };
}

export async function fetchCampaigns(
  opts: Filters & { hideNoSpend?: boolean; minSpend?: number; sort?: SortKey }
): Promise<CampaignRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_campaigns", {
    ...rpcParams(opts),
    p_hide_no_spend: opts.hideNoSpend ?? true,
    p_min_spend: opts.minSpend ?? 0,
  });
  if (error) throw new Error(`dashboard_campaigns: ${error.message}`);
  const rows = ((data ?? []) as any[]).map((r) => ({
    form_id: r.form_id,
    form_name: r.form_name,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    created_time: r.created_time,
    currency: r.currency,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    spend: Number(r.spend ?? 0),
    leads: Number(r.leads ?? 0),
    bookings: Number(r.bookings ?? 0),
    revenue: Number(r.revenue ?? 0),
    profit: Number(r.profit ?? 0),
    cpl: Number(r.cpl ?? 0),
    roas: Number(r.roas ?? 0),
  } satisfies CampaignRow));

  const sort: SortKey = opts.sort ?? "newest";
  const cmp: Record<SortKey, (a: CampaignRow, b: CampaignRow) => number> = {
    newest:       (a, b) => (b.created_time ?? "").localeCompare(a.created_time ?? ""),
    oldest:       (a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""),
    spend_desc:   (a, b) => b.spend - a.spend,
    spend_asc:    (a, b) => a.spend - b.spend,
    leads_desc:   (a, b) => b.leads - a.leads,
    revenue_desc: (a, b) => b.revenue - a.revenue,
    profit_desc:  (a, b) => b.profit - a.profit,
  };
  rows.sort(cmp[sort]);
  return rows;
}

export async function fetchAgents(opts: Filters): Promise<AgentRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_agents", rpcParams(opts));
  if (error) throw new Error(`dashboard_agents: ${error.message}`);
  const rows = ((data ?? []) as any[]).map((r) => ({
    agent_id: r.agent_id,
    agent_name: r.agent_name,
    team_id: r.team_id,
    team_name: r.team_name,
    leads: Number(r.leads ?? 0),
    bookings: Number(r.bookings ?? 0),
    spend: Number(r.spend ?? 0),
    revenue: Number(r.revenue ?? 0),
    profit: Number(r.profit ?? 0),
    cpl: Number(r.cpl ?? 0),
    roas: Number(r.roas ?? 0),
  } satisfies AgentRow));
  rows.sort((a, b) => b.revenue - a.revenue || b.leads - a.leads || (a.agent_name ?? "").localeCompare(b.agent_name ?? ""));
  return rows;
}

export async function fetchKpi(opts: Filters): Promise<{
  summary: KpiSummary;
  trend: { date: string; spend: number; revenue: number; profit: number }[];
}> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_kpi", rpcParams(opts));
  if (error) throw new Error(`dashboard_kpi: ${error.message}`);
  const row = (data ?? [])[0] ?? {};
  return {
    summary: {
      spend: Number(row.spend ?? 0),
      revenue: Number(row.revenue ?? 0),
      leads: Number(row.leads ?? 0),
      bookings: Number(row.bookings ?? 0),
      profit: Number(row.profit ?? 0),
      cpl: Number(row.cpl ?? 0),
      roas: Number(row.roas ?? 0),
      margin: Number(row.margin ?? 0),
    },
    trend: (row.trend ?? []) as { date: string; spend: number; revenue: number; profit: number }[],
  };
}

// Teams = roll-up of agents (small, computed in JS — already on the server).
export function byTeam(agents: AgentRow[]): AgentRow[] {
  const map = new Map<string, AgentRow>();
  for (const a of agents) {
    const key = a.team_id ?? "__no_team__";
    const row = map.get(key) ?? {
      agent_id: null,
      agent_name: null,
      team_id: a.team_id,
      team_name: a.team_name ?? "(no team)",
      leads: 0, bookings: 0, spend: 0, revenue: 0, profit: 0, cpl: 0, roas: 0,
    };
    row.leads += a.leads;
    row.bookings += a.bookings;
    row.spend += a.spend;
    row.revenue += a.revenue;
    row.profit = row.revenue - row.spend;
    map.set(key, row);
  }
  const result = [...map.values()];
  for (const r of result) {
    r.cpl = r.leads ? r.spend / r.leads : 0;
    r.roas = r.spend ? r.revenue / r.spend : 0;
  }
  return result.sort((a, b) => b.revenue - a.revenue);
}

// Group forms under their parent Meta campaign. AED-normalised parent rows.
export type CampaignGroup = {
  key: string;
  parent: CampaignRow;
  children: CampaignRow[];
};

const AED_PER_USD = 3.67;
function toAED(n: number, currency: string | null | undefined) {
  if (!Number.isFinite(n)) return 0;
  return (currency || "AED").toUpperCase() === "USD" ? n * AED_PER_USD : n;
}

export function groupByMetaCampaign(forms: CampaignRow[]): CampaignGroup[] {
  const groups = new Map<string, CampaignGroup>();
  for (const f of forms) {
    const key = f.campaign_id ?? `__nocampaign__:${f.form_id ?? f.form_name ?? "x"}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        children: [],
        parent: {
          form_id: null,
          form_name: f.campaign_name ?? f.form_name ?? "(no Meta campaign)",
          campaign_id: f.campaign_id,
          campaign_name: f.campaign_name,
          created_time: f.created_time,
          currency: "AED",
          impressions: 0, clicks: 0, spend: 0, leads: 0,
          bookings: 0, revenue: 0, profit: 0, cpl: 0, roas: 0,
        },
      };
      groups.set(key, g);
    }
    g.children.push(f);
    g.parent.impressions += f.impressions;
    g.parent.clicks += f.clicks;
    g.parent.spend += toAED(f.spend, f.currency);
    g.parent.leads += f.leads;
    g.parent.bookings += f.bookings;
    g.parent.revenue += toAED(f.revenue, f.currency);
  }
  for (const g of groups.values()) {
    g.parent.profit = g.parent.revenue - g.parent.spend;
    g.parent.cpl = g.parent.leads ? g.parent.spend / g.parent.leads : 0;
    g.parent.roas = g.parent.spend ? g.parent.revenue / g.parent.spend : 0;
  }
  return [...groups.values()].sort((a, b) => b.parent.spend - a.parent.spend);
}
