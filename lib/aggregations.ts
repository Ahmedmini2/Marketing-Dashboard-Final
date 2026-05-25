import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  AgentRow,
  CampaignRow,
  DateRange,
  KpiSummary,
  PerformanceRow,
  PerfSummary,
  PerfMonthStats,
  PerfTopAgent,
  PerfTopCampaign,
  PerfMonthlyTrendPoint,
} from "@/lib/types";
import type { Group } from "@/components/grouped-data-table";
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

// =========================================================================
// Performance Dashboard
// =========================================================================

/**
 * Fetch per-campaign-per-month performance rows from the `dashboard_performance`
 * Postgres function, then group them into Event and Non-Event month groups.
 */
export async function fetchPerformance(range: DateRange): Promise<{
  eventGroups: Group<PerformanceRow>[];
  nonEventGroups: Group<PerformanceRow>[];
}> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_performance", {
    p_from: range.from,
    p_to: `${range.to}T23:59:59.999Z`,
  });
  if (error) throw new Error(`dashboard_performance: ${error.message}`);

  // Raw rows from Postgres — one per (month × campaign_name)
  type RawRow = {
    month: string;
    campaign_name: string;
    event_type: "event" | "non_event";
    spend: number;
    leads: number;
    cpl: number;
    unit_price: number;
    gross_commission: number;
    net_commission: number;
    pnl: number;
    roi: number;
  };

  const rows: RawRow[] = ((data ?? []) as any[]).map((r) => ({
    month:            String(r.month ?? ""),
    campaign_name:    String(r.campaign_name ?? "(unknown)"),
    event_type:       r.event_type === "non_event" ? "non_event" : "event",
    spend:            Number(r.spend            ?? 0),
    leads:            Number(r.leads            ?? 0),
    cpl:              Number(r.cpl              ?? 0),
    unit_price:       Number(r.unit_price       ?? 0),
    gross_commission: Number(r.gross_commission ?? 0),
    net_commission:   Number(r.net_commission   ?? 0),
    pnl:              Number(r.pnl              ?? 0),
    roi:              Number(r.roi              ?? 0),
  }));

  return groupPerformanceByMonth(rows);
}

/** Convert "YYYY-MM" → "Jan 2025" */
function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  if (!y || !m) return yyyymm;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function zeroParent(label: string): PerformanceRow {
  return {
    label,
    spend: 0, leads: 0, cpl: 0,
    unit_price: 0, gross_commission: 0, net_commission: 0,
    pnl: 0, roi: 0,
  };
}

function groupPerformanceByMonth(
  rows: Array<{
    month: string;
    campaign_name: string;
    event_type: "event" | "non_event";
    spend: number;
    leads: number;
    cpl: number;
    unit_price: number;
    gross_commission: number;
    net_commission: number;
    pnl: number;
    roi: number;
  }>
): { eventGroups: Group<PerformanceRow>[]; nonEventGroups: Group<PerformanceRow>[] } {
  const eventMap    = new Map<string, Group<PerformanceRow>>();
  const nonEventMap = new Map<string, Group<PerformanceRow>>();

  for (const r of rows) {
    const map = r.event_type === "event" ? eventMap : nonEventMap;

    let g = map.get(r.month);
    if (!g) {
      g = { key: r.month, parent: zeroParent(monthLabel(r.month)), children: [] };
      map.set(r.month, g);
    }

    // Child = individual campaign row
    g.children.push({
      label:            r.campaign_name,
      spend:            r.spend,
      leads:            r.leads,
      cpl:              r.cpl,
      unit_price:       r.unit_price,
      gross_commission: r.gross_commission,
      net_commission:   r.net_commission,
      pnl:              r.pnl,
      roi:              r.roi,
    });

    // Accumulate parent totals
    const p = g.parent;
    p.spend            += r.spend;
    p.leads            += r.leads;
    p.unit_price       += r.unit_price;
    p.gross_commission += r.gross_commission;
    p.net_commission   += r.net_commission;
  }

  // Recalculate derived fields on parent (CPL, P&L, ROI)
  function finalise(g: Group<PerformanceRow>): Group<PerformanceRow> {
    const p = g.parent;
    p.cpl = p.leads > 0 ? p.spend / p.leads : 0;
    p.pnl = p.net_commission - p.spend;
    p.roi = p.spend > 0 ? p.pnl / p.spend : 0;
    return g;
  }

  const sort = (a: Group<PerformanceRow>, b: Group<PerformanceRow>) =>
    b.key.localeCompare(a.key); // newest month first

  return {
    eventGroups:    [...eventMap.values()].map(finalise).sort(sort),
    nonEventGroups: [...nonEventMap.values()].map(finalise).sort(sort),
  };
}

// =========================================================================
// Performance dashboard v2 — summary cards, current-month stats, top agents,
// top campaigns, and monthly trend (RPCs in 0005_performance_dashboard.sql).
// =========================================================================

const FAR_PAST = "1970-01-01T00:00:00.000Z";
const FAR_FUTURE = "2999-12-31T23:59:59.999Z";

/** All-time totals (the 4 hero cards on the Performance page). */
export async function fetchPerfSummary(): Promise<PerfSummary> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_perf_summary", {
    p_from: FAR_PAST,
    p_to: FAR_FUTURE,
  });
  if (error) throw new Error(`dashboard_perf_summary: ${error.message}`);
  const r = (data ?? [])[0] ?? {};
  return {
    spend:    Number(r.spend    ?? 0),
    revenue:  Number(r.revenue  ?? 0),
    pnl:      Number(r.pnl      ?? 0),
    roas:     Number(r.roas     ?? 0),
    leads:    Number(r.leads    ?? 0),
    bookings: Number(r.bookings ?? 0),
  };
}

/** Stats for one calendar month — used by the "Current Month" section. */
export async function fetchPerfMonthStats(
  year: number,
  month: number, // 1-12
): Promise<PerfMonthStats> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_perf_month_stats", {
    p_year: year,
    p_month: month,
  });
  if (error) throw new Error(`dashboard_perf_month_stats: ${error.message}`);
  const r = (data ?? [])[0] ?? {};
  return {
    spend:               Number(r.spend               ?? 0),
    revenue:             Number(r.revenue             ?? 0),
    pnl:                 Number(r.pnl                 ?? 0),
    roas:                Number(r.roas                ?? 0),
    leads:               Number(r.leads               ?? 0),
    bookings:            Number(r.bookings            ?? 0),
    event_campaigns:     Number(r.event_campaigns     ?? 0),
    non_event_campaigns: Number(r.non_event_campaigns ?? 0),
  };
}

/** Top agents this month, ranked by bookings (BNL) then revenue. */
export async function fetchPerfTopAgents(
  year: number,
  month: number,
  limit = 10,
): Promise<PerfTopAgent[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_perf_top_agents", {
    p_year: year,
    p_month: month,
    p_limit: limit,
  });
  if (error) throw new Error(`dashboard_perf_top_agents: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    agent_id:   r.agent_id ?? null,
    agent_name: r.agent_name ?? null,
    team_name:  r.team_name ?? null,
    bookings:   Number(r.bookings ?? 0),
    revenue:    Number(r.revenue  ?? 0),
    leads:      Number(r.leads    ?? 0),
  } satisfies PerfTopAgent));
}

/** Best-performing campaigns this month, ranked by P&L. */
export async function fetchPerfTopCampaigns(
  year: number,
  month: number,
  limit = 8,
): Promise<PerfTopCampaign[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_perf_top_campaigns", {
    p_year: year,
    p_month: month,
    p_limit: limit,
  });
  if (error) throw new Error(`dashboard_perf_top_campaigns: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    campaign_name: String(r.campaign_name ?? "(unknown)"),
    event_type:    r.event_type === "non_event" ? "non_event" : "event",
    spend:         Number(r.spend   ?? 0),
    revenue:       Number(r.revenue ?? 0),
    pnl:           Number(r.pnl     ?? 0),
    roas:          Number(r.roas    ?? 0),
    leads:         Number(r.leads   ?? 0),
  } satisfies PerfTopCampaign));
}

/** Monthly trend (default last 12 months) for the spend/revenue/P&L chart. */
export async function fetchPerfMonthlyTrend(
  months = 12,
): Promise<PerfMonthlyTrendPoint[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("dashboard_perf_monthly_trend", {
    p_months: months,
  });
  if (error) throw new Error(`dashboard_perf_monthly_trend: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    month:   String(r.month ?? ""),
    spend:   Number(r.spend   ?? 0),
    revenue: Number(r.revenue ?? 0),
    pnl:     Number(r.pnl     ?? 0),
  } satisfies PerfMonthlyTrendPoint));
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
