-- =========================================================================
-- 0007 — Home tab: daily Meta spend/leads (rolling window) + breakdown RPC
--
-- The Home "Spend & Lead Dashboard" needs accurate day-range views (7D/30D/
-- 90D/6M), which monthly insights can't serve. We store a rolling ~180-day
-- DAILY grain in a separate table (long-term pages keep the monthly grain).
--
-- Leads here = Meta-reported leads (from insights `actions`); CPL = spend ÷ leads.
-- Event vs Non-Event from the campaign name ('%non%' → non_event).
-- =========================================================================

create table if not exists meta_campaign_daily (
  campaign_id  text not null,
  date         date not null,
  spend        numeric(14,2) default 0,
  leads        integer default 0,
  impressions  integer default 0,
  clicks       integer default 0,
  primary key (campaign_id, date)
);
-- No FK to meta_campaigns: insights can reference archived campaigns; the sync
-- stubs unknown campaigns so the join still resolves, but we avoid the
-- whole-batch-rejection an FK would cause.
create index if not exists idx_mcd_date on meta_campaign_daily(date);

-- Per (account × event_type) spend + Meta leads over a day window. The Home
-- page rolls these up into Overview / Event / Platform / Account levels in JS.
create or replace function dashboard_home_breakdown(p_from date, p_to date)
returns table (
  account_id   text,
  account_name text,
  currency     text,
  event_type   text,
  spend_aed    numeric,
  leads        bigint
)
language sql stable as $$
  select
    c.ad_account_id,
    coalesce(a.name, c.ad_account_id),
    a.currency,
    case when lower(coalesce(c.name,'')) like '%non%' then 'non_event' else 'event' end as event_type,
    round(case when upper(coalesce(a.currency,'AED'))='USD'
               then sum(d.spend)*3.67 else sum(d.spend) end::numeric, 2) as spend_aed,
    coalesce(sum(d.leads),0)::bigint as leads
  from meta_campaign_daily d
  join meta_campaigns c     on c.id = d.campaign_id
  left join meta_ad_accounts a on a.id = c.ad_account_id
  where d.date >= p_from and d.date <= p_to
  group by c.ad_account_id, a.name, a.currency,
    case when lower(coalesce(c.name,'')) like '%non%' then 'non_event' else 'event' end;
$$;
