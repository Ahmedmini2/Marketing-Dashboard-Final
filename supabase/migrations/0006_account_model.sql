-- =========================================================================
-- 0006 — Account model + real monthly spend + improved SF↔Meta matching
--
-- Fixes the root causes found in diagnosis:
--   * Meta insights now carry a real MONTH dimension (sync uses
--     time_increment=monthly), so spend can be reported per month / per
--     account / per campaign instead of one all-time lump.
--   * SF Campaign_Name__c → Meta is resolved to a CAMPAIGN id via a combined
--     matcher (exact form, exact campaign, fuzzy form ≥0.60, fuzzy campaign
--     ≥0.50). Lifts lead coverage from ~50% → ~96%.
--   * Revenue = Net Commission (Total_Allegiance_Commission__c). Every booking
--     row counts (not gated on sales_journey). P&L = revenue − spend.
--
-- Canonical grains:
--   spend    → (campaign, month) from meta_form_insights  [REAL Meta spend]
--   leads    → sf_leads (created_date month, matched campaign/account)
--   revenue  → sf_bookings.net_commission (booked_at month, booking.agent_id)
--
-- AED: account spend converted USD×3.67. Commissions are treated as AED.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. Schema additions
-- -------------------------------------------------------------------------
alter table campaign_to_form add column if not exists campaign_id text;

-- widen the match_kind check to the new combined-matcher kinds
alter table campaign_to_form drop constraint if exists campaign_to_form_match_kind_check;
alter table campaign_to_form add constraint campaign_to_form_match_kind_check
  check (match_kind in ('exact','fuzzy','exact_form','exact_campaign','fuzzy_form','fuzzy_campaign'));

alter table lead_attribution add column if not exists account_id text;

create index if not exists idx_c2f_campaign on campaign_to_form(campaign_id);
create index if not exists idx_la_campaign  on lead_attribution(primary_campaign_id);
create index if not exists idx_la_account   on lead_attribution(account_id);
create index if not exists idx_mfi_camp_date on meta_form_insights(campaign_id, date);

-- =========================================================================
-- 1. refresh_campaign_to_form() — combined matcher → campaign_id (+ form_id)
-- =========================================================================
create or replace function refresh_campaign_to_form()
returns void language plpgsql as $$
begin
  perform set_limit(0.30);
  truncate campaign_to_form;

  with distinct_names as (
    select distinct lower(regexp_replace(coalesce(campaign_name,''), '\s+', ' ', 'g')) as norm
    from sf_leads
    where campaign_name is not null and campaign_name <> ''
  ),
  -- (1) exact match on a real (page-owned) form name that links to a campaign
  exact_form as (
    select distinct on (d.norm)
      d.norm, f.id as form_id, f.name as form_name, f.primary_campaign_id as campaign_id,
      'exact_form'::text as match_kind, 1.0::numeric as score
    from distinct_names d
    join meta_lead_forms f
      on f.page_id is not null and f.primary_campaign_id is not null
     and lower(regexp_replace(coalesce(f.name,''), '\s+', ' ', 'g')) = d.norm
    order by d.norm, f.created_time desc nulls last, f.id
  ),
  -- (2) exact match on a Meta campaign name
  exact_camp as (
    select distinct on (d.norm)
      d.norm, null::text as form_id, c.name as form_name, c.id as campaign_id,
      'exact_campaign'::text as match_kind, 1.0::numeric as score
    from distinct_names d
    left join exact_form e on e.norm = d.norm
    join meta_campaigns c
      on lower(regexp_replace(coalesce(c.name,''), '\s+', ' ', 'g')) = d.norm
    where e.norm is null
    order by d.norm, c.created_time desc nulls last, c.id
  ),
  -- (3) fuzzy match on form name (≥0.60)
  fuzzy_form as (
    select distinct on (d.norm)
      d.norm, f.id as form_id, f.name as form_name, f.primary_campaign_id as campaign_id,
      'fuzzy_form'::text as match_kind, similarity(lower(f.name), d.norm) as score
    from distinct_names d
    left join exact_form e  on e.norm = d.norm
    left join exact_camp ec on ec.norm = d.norm
    join meta_lead_forms f
      on f.page_id is not null and f.primary_campaign_id is not null
     and lower(f.name) % d.norm
    where e.norm is null and ec.norm is null
    order by d.norm, similarity(lower(f.name), d.norm) desc, f.id
  ),
  -- (4) fuzzy match on Meta campaign name (≥0.50)
  fuzzy_camp as (
    select distinct on (d.norm)
      d.norm, null::text as form_id, c.name as form_name, c.id as campaign_id,
      'fuzzy_campaign'::text as match_kind, similarity(lower(c.name), d.norm) as score
    from distinct_names d
    left join exact_form e   on e.norm = d.norm
    left join exact_camp ec  on ec.norm = d.norm
    left join fuzzy_form ff  on ff.norm = d.norm and ff.score >= 0.60
    join meta_campaigns c on lower(c.name) % d.norm
    where e.norm is null and ec.norm is null and ff.norm is null
    order by d.norm, similarity(lower(c.name), d.norm) desc, c.id
  )
  insert into campaign_to_form (campaign_name_norm, form_id, form_name, campaign_id, match_kind, score)
  select norm, form_id, form_name, campaign_id, match_kind, score from exact_form
  union all select norm, form_id, form_name, campaign_id, match_kind, score from exact_camp
  union all select norm, form_id, form_name, campaign_id, match_kind, score from fuzzy_form where score >= 0.60
  union all select norm, form_id, form_name, campaign_id, match_kind, score from fuzzy_camp where score >= 0.50;
end $$;

-- =========================================================================
-- 2. v_campaign_month — REAL spend / leads per (campaign, month)
-- =========================================================================
create or replace view v_campaign_month as
select
  c.ad_account_id                                            as account_id,
  i.campaign_id,
  c.name                                                     as campaign_name,
  date_trunc('month', i.date)::date                          as month,
  acct.currency,
  sum(i.spend)::numeric                                      as spend,
  case when upper(coalesce(acct.currency,'AED'))='USD'
       then sum(i.spend)*3.67 else sum(i.spend) end::numeric as spend_aed,
  coalesce(sum(i.leads),0)::bigint                           as meta_leads,
  coalesce(sum(i.impressions),0)::bigint                     as impressions,
  coalesce(sum(i.clicks),0)::bigint                          as clicks
from meta_form_insights i
join meta_campaigns c     on c.id = i.campaign_id
left join meta_ad_accounts acct on acct.id = c.ad_account_id
group by c.ad_account_id, i.campaign_id, c.name, date_trunc('month', i.date), acct.currency;

-- =========================================================================
-- 3. refresh_lead_attribution() — lead → campaign/account + real CPL + net comm
-- =========================================================================
create or replace function refresh_lead_attribution()
returns void language plpgsql as $$
begin
  truncate lead_attribution;

  insert into lead_attribution (
    lead_id, campaign_name, form_id, form_name, primary_campaign_id, account_id,
    agent_id, team_id, lead_status, sales_journey, created_date,
    attributed_spend, attributed_spend_aed, currency,
    bookings_count, revenue, revenue_aed
  )
  with cmonth as (
    select campaign_id, month, currency, account_id, spend_aed, meta_leads,
           case when meta_leads > 0 then spend_aed / meta_leads else 0 end as cpl_aed
    from v_campaign_month
  ),
  book as (
    select lead_id,
           sum(net_commission)::numeric as net_comm,
           count(*)::int                as bookings_count
    from sf_bookings
    where lead_id is not null
    group by lead_id
  )
  select
    sl.id,
    sl.campaign_name,
    cf.form_id,
    cf.form_name,
    cf.campaign_id,
    c.ad_account_id,
    sl.agent_id,
    a.team_id,
    sl.status,
    sl.sales_journey,
    sl.created_date,
    coalesce(cm.cpl_aed, 0)                  as attributed_spend,
    coalesce(cm.cpl_aed, 0)                  as attributed_spend_aed,
    cm.currency,
    coalesce(bk.bookings_count, 0)           as bookings_count,
    coalesce(bk.net_comm, 0)                 as revenue,
    coalesce(bk.net_comm, 0)                 as revenue_aed
  from sf_leads sl
  left join campaign_to_form cf
    on cf.campaign_name_norm = lower(regexp_replace(coalesce(sl.campaign_name,''), '\s+', ' ', 'g'))
  left join meta_campaigns c on c.id = cf.campaign_id
  left join cmonth cm
    on cm.campaign_id = cf.campaign_id
   and cm.month = date_trunc('month', sl.created_date)::date
  left join sf_agents a on a.id = sl.agent_id
  left join book bk     on bk.lead_id = sl.id;

  analyze lead_attribution;
end $$;

-- Rebuilding 200k+ leads exceeds the API's default statement timeout; give the
-- refresh helpers a longer ceiling so the in-app Sync button can run them.
alter function refresh_campaign_to_form()  set statement_timeout = '180s';
alter function refresh_lead_attribution()  set statement_timeout = '180s';

-- =========================================================================
-- 4. Overview / Performance RPCs (rewritten to use REAL spend + net comm)
-- =========================================================================

-- All-time / windowed totals (the 4 hero cards).
-- Month-aligned: spend is monthly grain, so leads/revenue are clamped to the
-- SAME whole months (b.ts_lo/ts_hi) — otherwise a mid-month range would compare
-- a full month of spend against a partial month of leads/revenue.
create or replace function dashboard_perf_summary(p_from timestamptz, p_to timestamptz)
returns table (spend numeric, revenue numeric, pnl numeric, roas numeric, leads bigint, bookings bigint)
language sql stable as $$
  with b as (
    select date_trunc('month',p_from)::date as m_lo, date_trunc('month',p_to)::date as m_hi,
           date_trunc('month',p_from) as ts_lo, (date_trunc('month',p_to)+interval '1 month') as ts_hi
  ),
  sp as (select coalesce(sum(spend_aed),0)::numeric spend from v_campaign_month, b where month>=b.m_lo and month<=b.m_hi),
  rv as (select coalesce(sum(net_commission),0)::numeric revenue, count(*)::bigint bookings from sf_bookings, b where booked_at>=b.ts_lo and booked_at<b.ts_hi),
  ld as (select count(*)::bigint leads from sf_leads, b where created_date>=b.ts_lo and created_date<b.ts_hi)
  select round(sp.spend,2), round(rv.revenue,2), round(rv.revenue-sp.spend,2),
    case when sp.spend>0 then round(rv.revenue/sp.spend,4) else 0 end, ld.leads, rv.bookings
  from sp, rv, ld;
$$;

-- Current-month statistics (+ event / non-event campaign counts)
create or replace function dashboard_perf_month_stats(p_year int, p_month int)
returns table (
  spend numeric, revenue numeric, pnl numeric, roas numeric,
  leads bigint, bookings bigint, event_campaigns bigint, non_event_campaigns bigint
)
language sql stable as $$
  with b as (
    select make_timestamptz(p_year,p_month,1,0,0,0) as p_from,
           (make_timestamptz(p_year,p_month,1,0,0,0) + interval '1 month') as p_to,
           make_date(p_year,p_month,1) as m
  ),
  sp as (
    select coalesce(sum(cm.spend_aed),0)::numeric as spend,
      count(distinct cm.campaign_id) filter (
        where lower(coalesce(cm.campaign_name,'')) not like '%non%'
          and (cm.spend_aed>0 or cm.meta_leads>0))::bigint as event_campaigns,
      count(distinct cm.campaign_id) filter (
        where lower(coalesce(cm.campaign_name,'')) like '%non%'
          and (cm.spend_aed>0 or cm.meta_leads>0))::bigint as non_event_campaigns
    from v_campaign_month cm, b where cm.month = b.m
  ),
  rv as (
    select coalesce(sum(sb.net_commission),0)::numeric as revenue, count(*)::bigint as bookings
    from sf_bookings sb, b where sb.booked_at >= b.p_from and sb.booked_at < b.p_to
  ),
  ld as (
    select count(*)::bigint as leads
    from sf_leads sl, b where sl.created_date >= b.p_from and sl.created_date < b.p_to
  )
  select round(sp.spend,2), round(rv.revenue,2), round(rv.revenue - sp.spend,2),
    case when sp.spend>0 then round(rv.revenue/sp.spend,4) else 0 end,
    ld.leads, rv.bookings, sp.event_campaigns, sp.non_event_campaigns
  from sp, rv, ld;
$$;

-- Top agents this month (ranked by bookings = BNL, then revenue)
create or replace function dashboard_perf_top_agents(p_year int, p_month int, p_limit int default 10)
returns table (agent_id text, agent_name text, team_name text, bookings bigint, revenue numeric, leads bigint)
language sql stable as $$
  with b as (
    select make_timestamptz(p_year,p_month,1,0,0,0) as p_from,
           (make_timestamptz(p_year,p_month,1,0,0,0) + interval '1 month') as p_to
  ),
  bk as (
    select sb.agent_id, sum(sb.net_commission)::numeric as revenue, count(*)::bigint as bookings
    from sf_bookings sb, b
    where sb.booked_at >= b.p_from and sb.booked_at < b.p_to and sb.agent_id is not null
    group by sb.agent_id
  ),
  lm as (
    select sl.agent_id, count(*)::bigint as leads
    from sf_leads sl, b
    where sl.created_date >= b.p_from and sl.created_date < b.p_to and sl.agent_id is not null
    group by sl.agent_id
  )
  select a.id, a.name, t.name,
    coalesce(bk.bookings,0)::bigint, round(coalesce(bk.revenue,0),2), coalesce(lm.leads,0)::bigint
  from sf_agents a
  left join bk on bk.agent_id = a.id
  left join lm on lm.agent_id = a.id
  left join sf_teams t on t.id = a.team_id
  where coalesce(bk.bookings,0) > 0 or coalesce(lm.leads,0) > 0
  order by bookings desc, revenue desc, leads desc
  limit p_limit;
$$;

-- Best campaigns this month (by P&L) — real Meta spend + matched revenue
create or replace function dashboard_perf_top_campaigns(p_year int, p_month int, p_limit int default 10)
returns table (campaign_name text, event_type text, spend numeric, revenue numeric, pnl numeric, roas numeric, leads bigint)
language sql stable as $$
  with b as (
    select make_timestamptz(p_year,p_month,1,0,0,0) as p_from,
           (make_timestamptz(p_year,p_month,1,0,0,0) + interval '1 month') as p_to,
           make_date(p_year,p_month,1) as m
  ),
  sp as (
    select cm.campaign_id, cm.campaign_name, cm.spend_aed as spend
    from v_campaign_month cm, b where cm.month = b.m
  ),
  ld as (
    select la.primary_campaign_id as campaign_id, count(*)::bigint as leads
    from lead_attribution la, b
    where la.created_date >= b.p_from and la.created_date < b.p_to and la.primary_campaign_id is not null
    group by la.primary_campaign_id
  ),
  rv as (
    select la.primary_campaign_id as campaign_id, coalesce(sum(sb.net_commission),0)::numeric as revenue
    from sf_bookings sb
    join lead_attribution la on la.lead_id = sb.lead_id, b
    where sb.booked_at >= b.p_from and sb.booked_at < b.p_to and la.primary_campaign_id is not null
    group by la.primary_campaign_id
  ),
  merged as (
    select
      coalesce(sp.campaign_id, ld.campaign_id, rv.campaign_id)         as campaign_id,
      coalesce(sp.campaign_name, mc.name, '(unknown)')                 as campaign_name,
      coalesce(sp.spend,0)::numeric                                    as spend,
      coalesce(rv.revenue,0)::numeric                                  as revenue,
      coalesce(ld.leads,0)::bigint                                     as leads
    from sp
    full join ld on ld.campaign_id = sp.campaign_id
    full join rv on rv.campaign_id = coalesce(sp.campaign_id, ld.campaign_id)
    left join meta_campaigns mc on mc.id = coalesce(sp.campaign_id, ld.campaign_id, rv.campaign_id)
  )
  select
    campaign_name,
    case when lower(coalesce(campaign_name,'')) like '%non%' then 'non_event' else 'event' end,
    round(spend,2), round(revenue,2), round(revenue-spend,2),
    case when spend>0 then round(revenue/spend,4) else 0 end, leads
  from merged
  where spend > 0 or leads > 0 or revenue > 0
  order by (revenue - spend) desc, revenue desc
  limit p_limit;
$$;

-- Monthly trend (last N months): real spend, net-commission revenue
create or replace function dashboard_perf_monthly_trend(p_months int default 12)
returns table (month text, spend numeric, revenue numeric, pnl numeric)
language sql stable as $$
  with b as (
    select (date_trunc('month', now()) - make_interval(months => greatest(p_months-1,0)))::date as from_m
  ),
  sp as (
    select cm.month, sum(cm.spend_aed)::numeric as spend
    from v_campaign_month cm, b where cm.month >= b.from_m
    group by cm.month
  ),
  rv as (
    select date_trunc('month', sb.booked_at)::date as month, sum(sb.net_commission)::numeric as revenue
    from sf_bookings sb, b where sb.booked_at >= b.from_m
    group by date_trunc('month', sb.booked_at)
  ),
  months as (
    select month from sp union select month from rv
  )
  select to_char(m.month,'YYYY-MM'),
    round(coalesce(sp.spend,0),2), round(coalesce(rv.revenue,0),2),
    round(coalesce(rv.revenue,0) - coalesce(sp.spend,0),2)
  from months m
  left join sp on sp.month = m.month
  left join rv on rv.month = m.month
  order by m.month asc;
$$;

-- =========================================================================
-- 5. Accounts tab RPCs
-- =========================================================================

-- Per-account rollup over a window (month-aligned, like dashboard_perf_summary).
-- `accessible` is true when the token can see the account (currency captured) OR
-- it already has synced campaign data — so a data-having account is never hidden.
create or replace function dashboard_accounts(p_from timestamptz, p_to timestamptz)
returns table (
  account_id text, account_name text, currency text,
  spend numeric, revenue numeric, pnl numeric, roas numeric,
  leads bigint, bookings bigint, campaigns bigint, accessible boolean
)
language sql stable as $$
  with b as (
    select date_trunc('month',p_from)::date as m_lo, date_trunc('month',p_to)::date as m_hi,
           date_trunc('month',p_from) as ts_lo, (date_trunc('month',p_to)+interval '1 month') as ts_hi
  ),
  sp as (
    select cm.account_id, sum(cm.spend_aed)::numeric spend,
           count(distinct cm.campaign_id) filter (where cm.spend_aed>0 or cm.meta_leads>0) campaigns
    from v_campaign_month cm, b where cm.month>=b.m_lo and cm.month<=b.m_hi group by cm.account_id
  ),
  ld as (select la.account_id, count(*)::bigint leads from lead_attribution la, b where la.created_date>=b.ts_lo and la.created_date<b.ts_hi and la.account_id is not null group by la.account_id),
  rv as (select la.account_id, coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings
         from sf_bookings sb join lead_attribution la on la.lead_id=sb.lead_id, b
         where sb.booked_at>=b.ts_lo and sb.booked_at<b.ts_hi and la.account_id is not null group by la.account_id)
  select acct.id, acct.name, acct.currency,
    round(coalesce(sp.spend,0),2), round(coalesce(rv.revenue,0),2),
    round(coalesce(rv.revenue,0)-coalesce(sp.spend,0),2),
    case when coalesce(sp.spend,0)>0 then round(coalesce(rv.revenue,0)/sp.spend,4) else 0 end,
    coalesce(ld.leads,0)::bigint, coalesce(rv.bookings,0)::bigint, coalesce(sp.campaigns,0)::bigint,
    (acct.currency is not null or coalesce(sp.campaigns,0)>0)
  from meta_ad_accounts acct
  left join sp on sp.account_id=acct.id
  left join ld on ld.account_id=acct.id
  left join rv on rv.account_id=acct.id
  order by round(coalesce(sp.spend,0),2) desc;
$$;

-- Campaigns within one account over a window (month-aligned).
create or replace function dashboard_account_campaigns(p_account_id text, p_from timestamptz, p_to timestamptz)
returns table (
  campaign_id text, campaign_name text, status text, event_type text,
  spend numeric, meta_leads bigint, sf_leads bigint, bookings bigint,
  revenue numeric, pnl numeric, roas numeric, cpl numeric
)
language sql stable as $$
  with b as (
    select date_trunc('month',p_from)::date as m_lo, date_trunc('month',p_to)::date as m_hi,
           date_trunc('month',p_from) as ts_lo, (date_trunc('month',p_to)+interval '1 month') as ts_hi
  ),
  sp as (select cm.campaign_id, cm.campaign_name, sum(cm.spend_aed)::numeric spend, sum(cm.meta_leads)::bigint meta_leads
         from v_campaign_month cm, b where cm.account_id=p_account_id and cm.month>=b.m_lo and cm.month<=b.m_hi
         group by cm.campaign_id, cm.campaign_name),
  ld as (select la.primary_campaign_id campaign_id, count(*)::bigint sf_leads from lead_attribution la, b
         where la.account_id=p_account_id and la.created_date>=b.ts_lo and la.created_date<b.ts_hi and la.primary_campaign_id is not null group by la.primary_campaign_id),
  rv as (select la.primary_campaign_id campaign_id, coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings
         from sf_bookings sb join lead_attribution la on la.lead_id=sb.lead_id, b
         where la.account_id=p_account_id and sb.booked_at>=b.ts_lo and sb.booked_at<b.ts_hi and la.primary_campaign_id is not null group by la.primary_campaign_id),
  ids as (select campaign_id from sp union select campaign_id from ld union select campaign_id from rv)
  select i.campaign_id, coalesce(sp.campaign_name, mc.name, '(unknown)'), mc.status,
    case when lower(coalesce(sp.campaign_name, mc.name,'')) like '%non%' then 'non_event' else 'event' end,
    round(coalesce(sp.spend,0),2), coalesce(sp.meta_leads,0)::bigint, coalesce(ld.sf_leads,0)::bigint,
    coalesce(rv.bookings,0)::bigint, round(coalesce(rv.revenue,0),2),
    round(coalesce(rv.revenue,0)-coalesce(sp.spend,0),2),
    case when coalesce(sp.spend,0)>0 then round(coalesce(rv.revenue,0)/sp.spend,4) else 0 end,
    case when coalesce(ld.sf_leads,0)>0 then round(coalesce(sp.spend,0)/ld.sf_leads,2) else 0 end
  from ids i
  left join sp on sp.campaign_id=i.campaign_id
  left join ld on ld.campaign_id=i.campaign_id
  left join rv on rv.campaign_id=i.campaign_id
  left join meta_campaigns mc on mc.id=i.campaign_id
  where coalesce(sp.spend,0)>0 or coalesce(ld.sf_leads,0)>0 or coalesce(rv.revenue,0)>0
  order by round(coalesce(sp.spend,0),2) desc, round(coalesce(rv.revenue,0),2) desc;
$$;

-- =========================================================================
-- 6. dashboard_performance — rewritten: per (month × Meta campaign) with REAL
--    spend, matched leads, and Booking_Price / Gross / Net commission sums.
--    Unmatched SF leads/bookings surface as a '(unattributed)' campaign.
-- =========================================================================
create or replace function dashboard_performance(p_from timestamptz, p_to timestamptz)
returns table (
  month text, campaign_name text, event_type text,
  spend numeric, leads bigint, cpl numeric,
  unit_price numeric, gross_commission numeric, net_commission numeric,
  pnl numeric, roi numeric
)
language sql stable as $$
  with b as (
    select date_trunc('month',p_from)::date as m_lo, date_trunc('month',p_to)::date as m_hi,
           date_trunc('month',p_from) as ts_lo, (date_trunc('month',p_to)+interval '1 month') as ts_hi
  ),
  sp as (   -- real spend per campaign × month
    select cm.campaign_id as cid, cm.campaign_name, cm.month, cm.spend_aed as spend
    from v_campaign_month cm, b where cm.month>=b.m_lo and cm.month<=b.m_hi
  ),
  ld as (   -- matched leads per campaign × created-month
    select coalesce(la.primary_campaign_id,'(none)') as cid, date_trunc('month',la.created_date)::date as month, count(*)::bigint as leads
    from lead_attribution la, b where la.created_date>=b.ts_lo and la.created_date<b.ts_hi group by 1,2
  ),
  bk as (   -- booking financials per campaign × booked-month
    select coalesce(la.primary_campaign_id,'(none)') as cid, date_trunc('month',sb.booked_at)::date as month,
           sum(sb.sale_amount)::numeric unit_price, sum(sb.gross_commission)::numeric gross_commission, sum(sb.net_commission)::numeric net_commission
    from sf_bookings sb left join lead_attribution la on la.lead_id=sb.lead_id, b
    where sb.booked_at>=b.ts_lo and sb.booked_at<b.ts_hi group by 1,2
  ),
  keys as (select coalesce(cid,'(none)') cid, month from sp union select cid, month from ld union select cid, month from bk)
  select to_char(k.month,'YYYY-MM'),
    case when k.cid='(none)' then '(unattributed)' else coalesce(mc.name, sp.campaign_name, '(unknown)') end,
    case when lower(coalesce(mc.name, sp.campaign_name,'')) like '%non%' then 'non_event' else 'event' end,
    round(coalesce(sp.spend,0),2), coalesce(ld.leads,0)::bigint,
    case when coalesce(ld.leads,0)>0 then round(coalesce(sp.spend,0)/ld.leads,2) else 0 end,
    round(coalesce(bk.unit_price,0),2), round(coalesce(bk.gross_commission,0),2), round(coalesce(bk.net_commission,0),2),
    round(coalesce(bk.net_commission,0)-coalesce(sp.spend,0),2),
    case when coalesce(sp.spend,0)>0 then round((coalesce(bk.net_commission,0)-sp.spend)/sp.spend,4) else 0 end
  from keys k
  left join sp on coalesce(sp.cid,'(none)')=k.cid and sp.month=k.month
  left join ld on ld.cid=k.cid and ld.month=k.month
  left join bk on bk.cid=k.cid and bk.month=k.month
  left join meta_campaigns mc on mc.id=k.cid and k.cid<>'(none)'
  where coalesce(sp.spend,0)>0 or coalesce(ld.leads,0)>0 or coalesce(bk.net_commission,0)<>0
  order by k.month desc, coalesce(sp.spend,0) desc;
$$;
