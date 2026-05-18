"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { todayISO } from "@/lib/utils";

type Option = { id: string; name: string };

export function FilterBar(props: { campaigns: Option[]; agents: Option[]; teams: Option[]; }) {
  return (
    <Suspense fallback={<div className="panel p-3 h-20" />}>
      <FilterBarInner {...props} />
    </Suspense>
  );
}

function FilterBarInner({
  campaigns, agents, teams,
}: {
  campaigns: Option[];
  agents: Option[];
  teams: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Defer todayISO defaults to the client to avoid SSR/CSR hydration mismatches
  // (server's "today" can differ from the client's by minutes or timezone).
  const [from, setFrom] = useState(() => params.get("from") ?? "");
  const [to, setTo] = useState(() => params.get("to") ?? "");
  const [campaignId, setCampaignId] = useState(params.get("campaign") ?? "");
  const [agentId, setAgentId] = useState(params.get("agent") ?? "");
  const [teamId, setTeamId] = useState(params.get("team") ?? "");
  const [sort, setSort] = useState(params.get("sort") ?? "newest");
  const [minSpend, setMinSpend] = useState(params.get("min_spend") ?? "");
  const [showNoSpend, setShowNoSpend] = useState(params.get("hide_no_spend") === "0");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    if (!params.get("from")) setFrom(todayISO(-1095));
    if (!params.get("to")) setTo(todayISO(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync local state when URL params change (e.g. browser back/forward).
  useEffect(() => {
    setFrom(params.get("from") ?? todayISO(-1095));
    setTo(params.get("to") ?? todayISO(0));
    setCampaignId(params.get("campaign") ?? "");
    setAgentId(params.get("agent") ?? "");
    setTeamId(params.get("team") ?? "");
    setSort(params.get("sort") ?? "newest");
    setMinSpend(params.get("min_spend") ?? "");
    setShowNoSpend(params.get("hide_no_spend") === "0");
  }, [params]);

  // Auto-apply: every state change pushes to the URL (skips the initial mount).
  const skipInitial = useRef(true);
  useEffect(() => {
    if (!mounted) return;
    if (skipInitial.current) { skipInitial.current = false; return; }
    const sp = new URLSearchParams();
    sp.set("from", from);
    sp.set("to", to);
    if (campaignId) sp.set("campaign", campaignId);
    if (agentId) sp.set("agent", agentId);
    if (teamId) sp.set("team", teamId);
    if (sort && sort !== "newest") sp.set("sort", sort);
    if (minSpend && Number(minSpend) > 0) sp.set("min_spend", minSpend);
    if (showNoSpend) sp.set("hide_no_spend", "0");
    const next = `${pathname}?${sp.toString()}`;
    if (next !== `${pathname}?${params.toString()}`) {
      router.push(next);
    }
    // We deliberately leave pathname/params off the deps so this only fires on filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, from, to, campaignId, agentId, teamId, sort, minSpend, showNoSpend]);

  function preset(days: number) {
    setFrom(todayISO(-days));
    setTo(todayISO(0));
  }

  return (
    <div className="panel p-3 flex flex-wrap items-end gap-3">
      <div>
        <div className="kpi-label">From</div>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <div className="kpi-label">To</div>
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="flex gap-1">
        {[7, 30, 90, 365].map((d) => (
          <button key={d} type="button" className="btn" onClick={() => preset(d)}>{d >= 365 ? "1y" : `${d}d`}</button>
        ))}
        <button type="button" className="btn" onClick={() => preset(1095)}>All</button>
      </div>

      <div className="min-w-56">
        <div className="kpi-label">Campaign / Form</div>
        <select className="input w-full" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="min-w-56">
        <div className="kpi-label">Agent</div>
        <select className="input w-full" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">All</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="min-w-44">
        <div className="kpi-label">Team</div>
        <select className="input w-full" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">All</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="min-w-44">
        <div className="kpi-label">Sort by</div>
        <select className="input w-full" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest forms first</option>
          <option value="oldest">Oldest forms first</option>
          <option value="spend_desc">Spend (high → low)</option>
          <option value="spend_asc">Spend (low → high)</option>
          <option value="leads_desc">Leads (most)</option>
          <option value="revenue_desc">Revenue (most)</option>
          <option value="profit_desc">P&L (most)</option>
        </select>
      </div>

      <div className="w-28">
        <div className="kpi-label">Min Spend</div>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="0"
          className="input w-full"
          value={minSpend}
          onChange={(e) => setMinSpend(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-muted self-end pb-2 cursor-pointer">
        <input
          type="checkbox"
          checked={showNoSpend}
          onChange={(e) => setShowNoSpend(e.target.checked)}
        />
        Include $0-spend forms
      </label>
    </div>
  );
}
