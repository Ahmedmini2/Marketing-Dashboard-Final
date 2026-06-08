// Thin wrapper around the Meta Graph API. We deliberately use fetch instead of
// the official SDK so we keep dependencies tight and have full control over
// pagination / error handling.

const VERSION = process.env.META_API_VERSION || "v21.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

export class MetaApiError extends Error {
  constructor(public status: number, public payload: unknown) {
    super(typeof payload === "object" && payload && "error" in (payload as any)
      ? (payload as any).error?.message ?? "Meta API error"
      : `Meta API error ${status}`);
  }
}

// Meta error codes that are transient and worth retrying.
// https://developers.facebook.com/docs/graph-api/guides/error-handling/
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 341, 368, 613]);
// App / user / account rate-limit codes — need long, patient backoff (the
// limit resets on a rolling window, typically within a few minutes).
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004]);

async function fetchJson<T>(url: string, token: string, attempt = 1): Promise<T> {
  const u = new URL(url);
  if (!u.searchParams.has("access_token")) u.searchParams.set("access_token", token);

  let res: Response;
  let body: any;
  try {
    res = await fetch(u.toString(), { method: "GET" });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    // Network-level error — retry.
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 4 ** (attempt - 1)));
      return fetchJson<T>(url, token, attempt + 1);
    }
    throw e;
  }

  if (!res.ok) {
    const code = body?.error?.code;
    const isRateLimit = typeof code === "number" && RATE_LIMIT_CODES.has(code);
    const transient = res.status >= 500 || (typeof code === "number" && TRANSIENT_CODES.has(code));
    // Rate limits get a longer, patient schedule (30s,60s,90s,120s,120s…, up to
    // 10 tries); other transient errors a short exponential one (up to 6 tries).
    // NOTE: rate-limit codes (e.g. 32, 80004) arrive as HTTP 400 and are NOT in
    // TRANSIENT_CODES, so the retry gate must check isRateLimit explicitly —
    // otherwise these would throw immediately with no backoff.
    const maxAttempts = isRateLimit ? 10 : 6;
    if ((transient || isRateLimit) && attempt < maxAttempts) {
      const wait = isRateLimit
        ? Math.min(120000, 30000 * attempt)
        : Math.min(60000, 1000 * 3 ** (attempt - 1));
      console.warn(`[meta] ${isRateLimit ? "rate-limit" : "transient"} error attempt=${attempt} status=${res.status} code=${code} msg=${body?.error?.message ?? "?"} → backoff ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      return fetchJson<T>(url, token, attempt + 1);
    }
    throw new MetaApiError(res.status, body);
  }
  return body as T;
}

type Paginated<T> = { data: T[]; paging?: { next?: string; cursors?: any } };

export async function* paginate<T>(initialUrl: string, token: string): AsyncGenerator<T> {
  let next: string | undefined = initialUrl;
  while (next) {
    const page: Paginated<T> = await fetchJson<Paginated<T>>(next, token);
    for (const row of page.data) yield row;
    next = page.paging?.next;
  }
}

export type AdAccount = {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
};

export type Campaign = {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  created_time?: string;
};

export type LeadForm = {
  id: string;
  name: string;
  page?: { id: string };
  status?: string;
  created_time?: string;
};

export type FormInsight = {
  date_start: string;
  date_stop: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
};

/** /me/adaccounts — sanity-check what the token can see. */
export async function listAdAccounts(token: string): Promise<AdAccount[]> {
  const out: AdAccount[] = [];
  for await (const r of paginate<AdAccount>(
    `${BASE}/me/adaccounts?fields=id,account_id,name,currency,timezone_name&limit=100`,
    token
  )) out.push(r);
  return out;
}

export async function listCampaigns(accountId: string, token: string): Promise<Campaign[]> {
  const out: Campaign[] = [];
  for await (const r of paginate<Campaign>(
    `${BASE}/${accountId}/campaigns?fields=id,name,objective,status,created_time&limit=200`,
    token
  )) out.push(r);
  return out;
}

/** Fetch a single lead form's metadata by id. */
export async function getLeadForm(formId: string, token: string): Promise<LeadForm | null> {
  try {
    const url = new URL(`${BASE}/${formId}`);
    url.searchParams.set("fields", "id,name,page,status,created_time");
    url.searchParams.set("access_token", token);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    return (await res.json()) as LeadForm;
  } catch {
    return null;
  }
}

export async function getAdAccount(accountId: string, token: string): Promise<AdAccount | null> {
  try {
    const url = new URL(`${BASE}/${accountId}`);
    url.searchParams.set("fields", "id,account_id,name,currency,timezone_name");
    url.searchParams.set("access_token", token);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    return (await res.json()) as AdAccount;
  } catch {
    return null;
  }
}

export type PageWithToken = { id: string; name: string; access_token: string };

/** /me/accounts — returns the pages this token can manage, each with its own page access token. */
export async function listPagesWithTokens(token: string): Promise<PageWithToken[]> {
  const out: PageWithToken[] = [];
  for await (const r of paginate<PageWithToken>(
    `${BASE}/me/accounts?fields=id,name,access_token&limit=100`,
    token
  )) out.push(r);
  return out;
}

/** List ALL lead forms for a page. Uses the page-scoped access token. */
export async function listPageLeadForms(pageId: string, pageToken: string): Promise<LeadForm[]> {
  const out: LeadForm[] = [];
  for await (const r of paginate<LeadForm>(
    `${BASE}/${pageId}/leadgen_forms?fields=id,name,page,status,created_time&limit=200`,
    pageToken
  )) out.push(r);
  return out;
}

/**
 * Pull campaign-level insights for a date range, broken down BY MONTH
 * (`time_increment=monthly`). Returns one row per (campaign × month) with
 * `date_start` = first day of the month. This monthly grain is what gives the
 * dashboard real per-month / per-account / per-campaign spend — without it,
 * Meta collapses the whole window into a single lump row and current-month
 * spend is impossible to report.
 */
export async function getCampaignInsightsMonthly(
  accountId: string,
  token: string,
  since: string,
  until: string
): Promise<FormInsight[]> {
  const url = new URL(`${BASE}/${accountId}/insights`);
  url.searchParams.set(
    "fields",
    "campaign_id,campaign_name,spend,impressions,clicks,actions,date_start,date_stop"
  );
  url.searchParams.set("level", "campaign");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("time_increment", "monthly");
  url.searchParams.set("limit", "500");

  const out: FormInsight[] = [];
  for await (const r of paginate<FormInsight>(url.toString(), token)) out.push(r);
  return out;
}

/** Split [since, until] into ≤stepDays inclusive date slices. */
function dateSlices(since: string, until: string, stepDays: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const end = new Date(until);
  let s = new Date(since);
  while (s <= end) {
    const e = new Date(s);
    e.setDate(e.getDate() + stepDays - 1);
    out.push([s.toISOString().slice(0, 10), (e > end ? end : e).toISOString().slice(0, 10)]);
    s = new Date(e);
    s.setDate(s.getDate() + 1);
  }
  return out;
}

/**
 * Pull campaign-level insights broken down BY DAY (`time_increment=1`) for a
 * recent window. Powers the Home tab's exact day-range views (7D/30D/90D/6M).
 * Only a rolling window is pulled/stored — long-term pages use the monthly grain.
 *
 * The window is fetched in 30-day slices: a multi-month daily campaign-level
 * query is too expensive for large accounts and Meta rejects it with a
 * transient "Service temporarily unavailable" — small slices are reliable.
 */
export async function getCampaignInsightsDaily(
  accountId: string,
  token: string,
  since: string,
  until: string
): Promise<FormInsight[]> {
  const out: FormInsight[] = [];
  for (const [sStart, sEnd] of dateSlices(since, until, 30)) {
    const url = new URL(`${BASE}/${accountId}/insights`);
    url.searchParams.set(
      "fields",
      "campaign_id,campaign_name,spend,impressions,clicks,actions,date_start,date_stop"
    );
    url.searchParams.set("level", "campaign");
    url.searchParams.set("time_range", JSON.stringify({ since: sStart, until: sEnd }));
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("limit", "500");
    for await (const r of paginate<FormInsight>(url.toString(), token)) out.push(r);
  }
  return out;
}

/** Resolve which lead forms a campaign uses (via its ads -> creatives -> lead_gen_form). */
export async function getCampaignLeadForms(
  campaignId: string,
  token: string
): Promise<string[]> {
  type Ad = { id: string; creative?: { id?: string; lead_gen_form_id?: string } };
  const formIds = new Set<string>();
  const url = `${BASE}/${campaignId}/ads?fields=creative{lead_gen_form_id}&limit=200`;
  for await (const ad of paginate<Ad>(url, token)) {
    const id = ad.creative?.lead_gen_form_id;
    if (id) formIds.add(id);
  }
  return [...formIds];
}

export function leadsFromActions(actions?: FormInsight["actions"]): number {
  if (!actions) return 0;
  const types = new Set([
    "lead",
    "leadgen.other",
    "onsite_conversion.lead_grouped",
  ]);
  return actions
    .filter((a) => types.has(a.action_type))
    .reduce((sum, a) => sum + Number(a.value || 0), 0);
}
