// One-off backfill for meta_campaign_daily (Home tab). Pulls daily Meta
// insights for the rolling window across all configured accounts and upserts
// them, without re-running the heavier monthly/forms sync. The in-app sync
// (lib/meta/sync.ts) does the same on every Sync going forward.
//
//   node scripts/backfill-daily.cjs [lookbackDays=180]

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function env(k) {
  const txt = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = txt.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim() : undefined;
}
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function leadsFromActions(actions) {
  if (!actions) return 0;
  const t = new Set(["lead", "leadgen.other", "onsite_conversion.lead_grouped"]);
  return actions.filter((a) => t.has(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Retry transient (code 1/2) + rate-limit (code 4) errors with backoff.
async function fetchJsonRetry(url, attempt = 1) {
  const res = await fetch(url);
  const j = await res.json();
  if (j.error) {
    const code = j.error.code;
    const retryable = code === 1 || code === 2 || code === 4 || res.status >= 500;
    if (retryable && attempt <= 8) {
      const wait = code === 4 ? Math.min(120000, 30000 * attempt) : 1000 * 2 ** attempt;
      console.log(`    retry ${attempt} (code ${code}) backoff ${wait}ms`);
      await sleep(wait);
      return fetchJsonRetry(url, attempt + 1);
    }
  }
  return j;
}

(async () => {
  const token = env("META_ACCESS_TOKEN");
  const ver = env("META_API_VERSION") || "v21.0";
  const base = `https://graph.facebook.com/${ver}`;
  const accounts = (env("META_AD_ACCOUNT_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const lookback = Number(process.argv[2] || 180);
  const since = isoDaysAgo(lookback);
  const until = isoDaysAgo(0);

  const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  // 30-day slices: a 180-day daily campaign-level query is too heavy for large
  // accounts (Meta returns "Service temporarily unavailable"). Small slices are
  // reliable.
  function slices(fromIso, toIso, stepDays) {
    const out = [];
    let s = new Date(fromIso);
    const end = new Date(toIso);
    while (s <= end) {
      const e = new Date(s);
      e.setDate(e.getDate() + stepDays - 1);
      out.push([s.toISOString().slice(0, 10), (e > end ? end : e).toISOString().slice(0, 10)]);
      s = new Date(e);
      s.setDate(s.getDate() + 1);
    }
    return out;
  }

  let totalRows = 0;
  for (const acct of accounts) {
    const rows = [];
    for (const [sStart, sEnd] of slices(since, until, 30)) {
      const url = new URL(`${base}/${acct}/insights`);
      url.searchParams.set("fields", "campaign_id,spend,impressions,clicks,actions,date_start");
      url.searchParams.set("level", "campaign");
      url.searchParams.set("time_range", JSON.stringify({ since: sStart, until: sEnd }));
      url.searchParams.set("time_increment", "1");
      url.searchParams.set("limit", "500");
      url.searchParams.set("access_token", token);

      let next = url.toString();
      let guard = 0;
      while (next && guard++ < 200) {
        const j = await fetchJsonRetry(next);
        if (j.error) {
          console.log(`  ${acct} ${sStart}..${sEnd} ERROR`, JSON.stringify(j.error));
          break;
        }
        for (const ins of j.data || []) {
          if (!ins.campaign_id || !ins.date_start) continue;
          rows.push({
            campaign_id: ins.campaign_id,
            date: ins.date_start,
            spend: Number(ins.spend || 0),
            impressions: Number(ins.impressions || 0),
            clicks: Number(ins.clicks || 0),
            leads: leadsFromActions(ins.actions),
          });
        }
        next = j.paging && j.paging.next;
      }
    }

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db
        .from("meta_campaign_daily")
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "campaign_id,date" });
      if (error) {
        console.log(`  ${acct} upsert error:`, error.message);
        break;
      }
    }
    totalRows += rows.length;
    console.log(`  ${acct}: ${rows.length} daily rows`);
  }
  console.log(`DONE. ${since}..${until} · ${totalRows} rows total`);
})().catch((e) => console.log("FATAL", e.message));
