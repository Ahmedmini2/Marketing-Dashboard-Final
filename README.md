# Marketing Dashboard

A Next.js dashboard that joins **Meta Ads** spend (campaigns + lead-gen forms) with
**Salesforce** leads + bookings to compute revenue and P&L per campaign, agent, and team.

Data is cached in **Supabase** so the dashboard never refetches from Meta or Salesforce on
every render — a single "Sync now" button (and an optional cron) refreshes it.

---

## Architecture

```
 Meta Ads  ──► /api/sync/meta      ──┐
                                     ├──► Supabase (Postgres)  ──► Dashboard pages
 Salesforce ─► /api/sync/salesforce ─┘                              + filters
```

- `meta_form_insights` stores daily spend / leads per (form, campaign).
- `sf_leads` stores Salesforce leads with their `campaign_name`.
- The **attribution rule**: `sf_leads.campaign_name` (case-insensitive) ==
  `meta_lead_forms.name`. Spend per lead = form spend ÷ form leads.
- `sf_bookings` brings in the sale amount per lead → revenue per agent / team / campaign.
- See `supabase/migrations/0001_init.sql` for the `v_lead_attribution` view that drives the UI.

## Setup

1. **Copy env file** and answer the two questions at the top:
   ```bash
   cp .env.example .env.local
   ```
   The questions are about *which* Meta API and *which* Salesforce auth flow you want.
   The scaffold defaults to Meta Marketing API + Salesforce OAuth Web-Server flow.

2. **Create a Supabase project** and apply the migrations:
   - Open the SQL editor, paste `supabase/migrations/0001_init.sql`, then `0002_rls.sql`.
   - Copy the URL, anon key, and service-role key into `.env.local`.

3. **Configure Meta**:
   - In `developers.facebook.com`, create a Business App.
   - Add the **Marketing API** product and generate a long-lived access token
     (scopes: `ads_read`, `leads_retrieval`, `pages_read_engagement`, `business_management`).
   - Put the token + comma-separated `act_*` account ids in `.env.local`.

4. **Configure Salesforce**:
   - In Setup → App Manager → New Connected App.
   - Enable OAuth, scopes: `api`, `refresh_token`, `offline_access`.
   - Callback URL: `${APP_URL}/api/auth/salesforce/callback`.
   - Copy the Consumer Key & Secret into `.env.local`.

5. **Install and run**:
   ```bash
   npm install
   npm run dev
   ```
   Open `http://localhost:3000` → sign up → connect Salesforce → click **Sync now**.

## How a sync runs

A full sync takes **9–17 minutes** (5 Meta ad accounts × 3 years of monthly insights + a
180-day daily window, then ~226K Salesforce leads). That is far longer than any proxy will
hold a connection open, so the sync does **not** run inside the request:

```
POST /api/sync/all      → 202 { jobId }        (returns in milliseconds)
                          ↓ work continues on the container
GET  /api/sync/status?id=<jobId>               (UI polls every 5s)
                          ↓
sync_jobs.status → 'success' | 'error'
```

`lib/sync/runner.ts` owns the background run. It stamps `sync_jobs.heartbeat_at` every 15s,
so a job whose runner died (container restart, redeploy mid-sync) is distinguishable from a
slow one and gets closed out by `sweep_stale_sync_jobs()` after 5 minutes instead of sitting
at `running` forever.

Only one sync runs at a time — starting a second joins the one in flight. Concurrent syncs
used to rate-limit each other on the Meta API and inflate run times.

> **Why it's built this way:** the sync used to be awaited inside the request. Railway's edge
> proxy cut the client connection minutes before the work finished and answered with the
> plaintext body `upstream error`; the dashboard called `r.json()` on it and displayed
> `Unexpected token 'u', "upstream error" is not valid JSON`. The syncs were succeeding the
> whole time — only the reporting was broken.

## Scheduled syncs

**On Railway** (where this is deployed), add a **cron service** in the same project:

- Root directory: this repo
- Start command: `node scripts/trigger-sync.cjs`
- Cron schedule: `0 */6 * * *`
- Variables: `APP_URL` (the public dashboard URL) and `SYNC_SECRET` (matching the app's)

The script triggers `/api/cron/sync` and then polls until the job finishes, so the Railway
run's duration and exit code reflect the actual sync rather than just its acceptance.

Any other scheduler works too — GET `/api/cron/sync` (or POST `/api/sync/all`) with
`Authorization: Bearer $SYNC_SECRET`. Both return `202 { jobId }` immediately; poll
`/api/sync/status?id=<jobId>` for the result.

> There is no `vercel.json` any more. It registered a 6-hour cron that only Vercel honours,
> so on Railway it never fired once — every run in `sync_jobs` was a manual "Sync now" click.
> If you move back to Vercel, note that the sync outlives even the 800s function ceiling, so
> the cron would need to trigger an external worker rather than run the sync itself.

## Filters

Every dashboard page supports `?from=YYYY-MM-DD&to=YYYY-MM-DD&campaign=<form_id>&agent=<sf_user_id>&team=<group_id>`.
The filter bar UI builds these for you.

## Field-mapping for non-standard Salesforce orgs

If your org doesn't use `Campaign_Name__c` or `Booking__c`, set the alternate names in
`.env.local`:

```
SF_LEAD_CAMPAIGN_FIELD=Your_Campaign_Field__c
SF_BOOKING_OBJECT=YourBooking__c
SF_BOOKING_AMOUNT_FIELD=Your_Amount__c
SF_BOOKING_LEAD_LOOKUP_FIELD=Your_Lead_Lookup__c
```

If `SF_BOOKING_OBJECT` doesn't exist, the sync falls back to `Opportunity` (where
`IsWon = true`) automatically.
