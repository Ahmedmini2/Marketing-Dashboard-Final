import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  listAdAccounts,
  listCampaigns,
  getDailyCampaignInsights,
  leadsFromActions,
  listPagesWithTokens,
  listPageLeadForms,
  getAdAccount,
} from "./client";
import { todayISO } from "@/lib/utils";

type SyncStats = {
  ad_accounts: number;
  campaigns: number;
  forms: number;
  insight_rows: number;
  form_campaign_matches: number;
  account_errors: Record<string, string>;
};

const LEAD_OBJECTIVES = new Set([
  "OUTCOME_LEADS",
  "LEAD_GENERATION",
  "LEADS",
]);

/**
 * Sync Meta data into Supabase.
 *
 * Architecture:
 *   1. Pull each ad account's daily campaign-level insights + the campaign list.
 *   2. Pull every page-owned lead form (real names) using each page's own
 *      access token (from /me/accounts).
 *   3. For each form, pick its primary campaign by trigram-similarity name
 *      match (within all known campaigns). Stores the match on
 *      meta_lead_forms.primary_campaign_id.
 *   4. meta_form_insights stays campaign-keyed; views use the form→campaign
 *      mapping to aggregate spend per form.
 *
 * Salesforce Lead.Campaign_Name__c → matches meta_lead_forms.name (real form
 * name), and spend rolls up via primary_campaign_id.
 */
export async function syncMeta(opts?: { since?: string; until?: string }): Promise<SyncStats> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not set");

  const idList = (process.env.META_AD_ACCOUNT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // If env lists ad accounts explicitly, fetch each account's metadata so we
  // capture currency + timezone (otherwise dashboard renders amounts wrong).
  const accounts = idList.length
    ? await Promise.all(idList.map(async (id) => {
        const meta = await getAdAccount(id, token);
        return meta ?? { id, account_id: id.replace(/^act_/, ""), name: id, currency: "", timezone_name: "" };
      }))
    : await listAdAccounts(token);

  // Pull a wide insights window by default so total_spend reflects lifetime,
  // not just the last 30 days. Override via env: META_INSIGHTS_LOOKBACK_DAYS.
  const lookback = Number(process.env.META_INSIGHTS_LOOKBACK_DAYS || 1095); // ~3 years
  const since = opts?.since ?? todayISO(-lookback);
  const until = opts?.until ?? todayISO(0);

  const db = supabaseAdmin();
  const stats: SyncStats = {
    ad_accounts: 0, campaigns: 0, forms: 0, insight_rows: 0,
    form_campaign_matches: 0, account_errors: {},
  };

  // 1) Per-account: insights + campaigns + insight rows.
  for (const acct of accounts) {
    try {
      await syncOneAccount(acct, token, since, until, db, stats);
      stats.ad_accounts++;
    } catch (e: any) {
      stats.account_errors[acct.id] = e?.message ?? String(e);
    }
  }

  // 2) Pages → real lead forms.
  try {
    await syncRealForms(token, db, stats);
  } catch (e: any) {
    stats.account_errors["pages"] = e?.message ?? String(e);
  }

  // 3) Resolve form → primary campaign by name similarity.
  try {
    stats.form_campaign_matches = await linkFormsToCampaigns(db);
  } catch (e: any) {
    stats.account_errors["form_matching"] = e?.message ?? String(e);
  }

  // 4) Refresh the SF campaign-name → form_id map + the materialised
  //    lead_attribution table. The dashboard RPCs read from these directly.
  try {
    let r = await db.rpc("refresh_campaign_to_form");
    if (r.error) throw new Error(r.error.message);
    r = await db.rpc("refresh_lead_attribution");
    if (r.error) throw new Error(r.error.message);
  } catch (e: any) {
    stats.account_errors["refresh_helpers"] = e?.message ?? String(e);
  }

  return stats;
}

async function syncOneAccount(
  acct: { id: string; name: string; currency: string; timezone_name: string },
  token: string,
  since: string,
  until: string,
  db: ReturnType<typeof supabaseAdmin>,
  stats: SyncStats
) {
  await db.from("meta_ad_accounts").upsert({
    id: acct.id,
    name: acct.name || acct.id,
    currency: acct.currency || null,
    timezone: acct.timezone_name || null,
    last_synced_at: new Date().toISOString(),
  });

  const insights = await getDailyCampaignInsights(acct.id, token, since, until);
  const campaigns = await listCampaigns(acct.id, token);

  if (campaigns.length) {
    await db.from("meta_campaigns").upsert(
      campaigns.map((c) => ({
        id: c.id,
        ad_account_id: acct.id,
        name: c.name,
        objective: c.objective ?? null,
        status: c.status ?? null,
        created_time: c.created_time ?? null,
      }))
    );
    stats.campaigns += campaigns.length;
  }

  // Lead-gen campaign ids — used to filter insights to relevant rows only.
  const leadCampaignSet = new Set(campaigns.filter((c) => c.objective && LEAD_OBJECTIVES.has(c.objective)).map((c) => c.id));

  // Insights are stored keyed by campaign_id (form_id = campaign_id). The FK
  // on meta_form_insights.form_id was dropped — views compute per-form spend
  // by joining meta_lead_forms.primary_campaign_id → meta_form_insights.campaign_id.
  const rows = insights
    .filter((ins) => ins.campaign_id && leadCampaignSet.has(ins.campaign_id))
    .map((ins) => ({
      form_id: ins.campaign_id!,
      campaign_id: ins.campaign_id!,
      date: ins.date_start,
      spend: Number(ins.spend ?? 0),
      impressions: Number(ins.impressions ?? 0),
      clicks: Number(ins.clicks ?? 0),
      leads: leadsFromActions(ins.actions),
    }));

  if (rows.length) {
    await db.from("meta_form_insights").upsert(rows, { onConflict: "form_id,campaign_id,date" });
    stats.insight_rows += rows.length;
  }
}

/** Pull every page's real lead-gen forms using each page's own access token. */
async function syncRealForms(
  userToken: string,
  db: ReturnType<typeof supabaseAdmin>,
  stats: SyncStats
) {
  const pages = await listPagesWithTokens(userToken);
  for (const page of pages) {
    let forms;
    try {
      forms = await listPageLeadForms(page.id, page.access_token);
    } catch (e: any) {
      stats.account_errors[`page:${page.id}`] = e?.message ?? String(e);
      continue;
    }
    if (!forms.length) continue;
    await db.from("meta_lead_forms").upsert(
      forms.map((f) => ({
        id: f.id,
        ad_account_id: null,
        page_id: page.id,
        name: f.name,
        status: f.status ?? null,
        created_time: f.created_time ?? null,
        // primary_campaign_id stays null — filled in by linkFormsToCampaigns().
      }))
    );
    stats.forms += forms.length;
  }
}

/**
 * For each real form (one with a page_id), find its most-similar Meta campaign
 * by trigram similarity and store the match on primary_campaign_id. Threshold
 * 0.30 — empirically a good cutoff for "obviously the same campaign in
 * different naming convention".
 */
async function linkFormsToCampaigns(db: ReturnType<typeof supabaseAdmin>): Promise<number> {
  const { error } = await db.rpc("link_forms_to_campaigns");
  if (error) throw new Error(`link_forms_to_campaigns: ${error.message}`);

  const { count } = await db
    .from("meta_lead_forms")
    .select("id", { head: true, count: "exact" })
    .not("primary_campaign_id", "is", null)
    .not("page_id", "is", null);
  return count ?? 0;
}
