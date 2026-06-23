-- =========================================================================
-- 0010 — Campaigns tab data + marketing-only P&L
--
-- 1. dashboard_campaigns_all_daily / _monthly: one row per Meta campaign
--    across all accounts, with account_name as a column. The Campaigns tab
--    now uses these (previously it grouped by form name, which obscured the
--    real Meta campaign names).
-- 2. dashboard_perf_summary / _month_stats / _monthly_trend: revenue is now
--    counted only for bookings whose lead is in sf_leads (i.e. marketing
--    sourced — FB only). Non-marketing bookings (cold/walk-in deals) no
--    longer inflate Overview revenue / P&L / ROAS.
-- =========================================================================

create or replace function dashboard_campaigns_all_daily(p_from date, p_to date)
returns table (
  account_id text, account_name text, currency text,
  campaign_id text, campaign_name text, status text, event_type text,
  spend numeric, meta_leads bigint, sf_leads bigint, bookings bigint,
  revenue numeric, pnl numeric, roas numeric, cpl numeric
)
language sql stable as $$
  with sp as (
    select c.ad_account_id, c.id as campaign_id, c.name as campaign_name, c.status, a.currency,
      sum(case when upper(coalesce(a.currency,'AED'))='USD' then d.spend*3.67 else d.spend end)::numeric as spend,
      sum(d.leads)::bigint as meta_leads
    from meta_campaign_daily d
    join meta_campaigns c on c.id = d.campaign_id
    left join meta_ad_accounts a on a.id = c.ad_account_id
    where d.date >= p_from and d.date <= p_to
    group by c.ad_account_id, c.id, c.name, c.status, a.currency
  ),
  ld as (
    select la.primary_campaign_id as campaign_id, count(*)::bigint sf_leads
    from lead_attribution la
    where la.created_date >= p_from::timestamptz
      and la.created_date <  (p_to::timestamptz + interval '1 day')
      and la.primary_campaign_id is not null
    group by la.primary_campaign_id
  ),
  rv as (
    select la.primary_campaign_id as campaign_id,
      coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings
    from sf_bookings sb
    join lead_attribution la on la.lead_id = sb.lead_id
    where sb.booked_at >= p_from::timestamptz
      and sb.booked_at <  (p_to::timestamptz + interval '1 day')
      and la.primary_campaign_id is not null
    group by la.primary_campaign_id
  )
  select
    sp.ad_account_id, coalesce(acct.name, sp.ad_account_id), sp.currency,
    sp.campaign_id, sp.campaign_name, sp.status,
    case when is_non_event(sp.campaign_name) then 'non_event' else 'event' end,
    round(coalesce(sp.spend,0),2), coalesce(sp.meta_leads,0)::bigint, coalesce(ld.sf_leads,0)::bigint,
    coalesce(rv.bookings,0)::bigint, round(coalesce(rv.revenue,0),2),
    round(coalesce(rv.revenue,0)-coalesce(sp.spend,0),2),
    case when coalesce(sp.spend,0)>0 then round(coalesce(rv.revenue,0)/sp.spend,4) else 0 end,
    case when coalesce(ld.sf_leads,0)>0 then round(coalesce(sp.spend,0)/ld.sf_leads,2) else 0 end
  from sp
  left join meta_ad_accounts acct on acct.id = sp.ad_account_id
  left join ld on ld.campaign_id = sp.campaign_id
  left join rv on rv.campaign_id = sp.campaign_id
  where coalesce(sp.spend,0) > 0 or coalesce(ld.sf_leads,0) > 0 or coalesce(rv.revenue,0) > 0
  order by round(coalesce(sp.spend,0),2) desc;
$$;

create or replace function dashboard_campaigns_all_monthly(p_from timestamptz, p_to timestamptz)
returns table (
  account_id text, account_name text, currency text,
  campaign_id text, campaign_name text, status text, event_type text,
  spend numeric, meta_leads bigint, sf_leads bigint, bookings bigint,
  revenue numeric, pnl numeric, roas numeric, cpl numeric
)
language sql stable as $$
  with b as (select date_trunc('month',p_from)::date as m_lo, date_trunc('month',p_to)::date as m_hi,
                    date_trunc('month',p_from) as ts_lo, (date_trunc('month',p_to)+interval '1 month') as ts_hi),
  sp as (
    select cm.account_id, cm.campaign_id, cm.campaign_name, cm.currency,
      sum(cm.spend_aed)::numeric as spend, sum(cm.meta_leads)::bigint as meta_leads
    from v_campaign_month cm, b where cm.month >= b.m_lo and cm.month <= b.m_hi
    group by cm.account_id, cm.campaign_id, cm.campaign_name, cm.currency
  ),
  ld as (
    select la.primary_campaign_id as campaign_id, count(*)::bigint sf_leads
    from lead_attribution la, b
    where la.created_date >= b.ts_lo and la.created_date < b.ts_hi and la.primary_campaign_id is not null
    group by la.primary_campaign_id
  ),
  rv as (
    select la.primary_campaign_id as campaign_id,
      coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings
    from sf_bookings sb join lead_attribution la on la.lead_id = sb.lead_id, b
    where sb.booked_at >= b.ts_lo and sb.booked_at < b.ts_hi and la.primary_campaign_id is not null
    group by la.primary_campaign_id
  )
  select sp.account_id, coalesce(acct.name, sp.account_id), sp.currency,
    sp.campaign_id, sp.campaign_name, mc.status,
    case when is_non_event(sp.campaign_name) then 'non_event' else 'event' end,
    round(coalesce(sp.spend,0),2), coalesce(sp.meta_leads,0)::bigint, coalesce(ld.sf_leads,0)::bigint,
    coalesce(rv.bookings,0)::bigint, round(coalesce(rv.revenue,0),2),
    round(coalesce(rv.revenue,0)-coalesce(sp.spend,0),2),
    case when coalesce(sp.spend,0)>0 then round(coalesce(rv.revenue,0)/sp.spend,4) else 0 end,
    case when coalesce(ld.sf_leads,0)>0 then round(coalesce(sp.spend,0)/ld.sf_leads,2) else 0 end
  from sp
  left join meta_ad_accounts acct on acct.id = sp.account_id
  left join meta_campaigns mc on mc.id = sp.campaign_id
  left join ld on ld.campaign_id = sp.campaign_id
  left join rv on rv.campaign_id = sp.campaign_id
  where coalesce(sp.spend,0) > 0 or coalesce(ld.sf_leads,0) > 0 or coalesce(rv.revenue,0) > 0
  order by round(coalesce(sp.spend,0),2) desc;
$$;

-- Marketing-only P&L: bookings counted only when their lead is in sf_leads
-- (i.e. came from FB / a marketing campaign).

create or replace function dashboard_perf_summary(p_from timestamptz, p_to timestamptz)
returns table (spend numeric, revenue numeric, pnl numeric, roas numeric, leads bigint, bookings bigint)
language sql stable as $$
  with b as (
    select date_trunc('month',p_from)::date as m_lo, date_trunc('month',p_to)::date as m_hi,
           date_trunc('month',p_from) as ts_lo, (date_trunc('month',p_to)+interval '1 month') as ts_hi
  ),
  sp as (select coalesce(sum(spend_aed),0)::numeric spend from v_campaign_month, b where month>=b.m_lo and month<=b.m_hi),
  rv as (
    select coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings
    from sf_bookings sb join sf_leads sl on sl.id = sb.lead_id, b
    where sb.booked_at>=b.ts_lo and sb.booked_at<b.ts_hi
  ),
  ld as (select count(*)::bigint leads from sf_leads, b where created_date>=b.ts_lo and created_date<b.ts_hi)
  select round(sp.spend,2), round(rv.revenue,2), round(rv.revenue-sp.spend,2),
    case when sp.spend>0 then round(rv.revenue/sp.spend,4) else 0 end, ld.leads, rv.bookings
  from sp, rv, ld;
$$;

create or replace function dashboard_perf_month_stats(p_year int, p_month int)
returns table (spend numeric, revenue numeric, pnl numeric, roas numeric, leads bigint, bookings bigint, event_campaigns bigint, non_event_campaigns bigint)
language sql stable as $$
  with b as (
    select make_timestamptz(p_year,p_month,1,0,0,0) as p_from,
           (make_timestamptz(p_year,p_month,1,0,0,0) + interval '1 month') as p_to, make_date(p_year,p_month,1) as m
  ),
  sp as (
    select coalesce(sum(cm.spend_aed),0)::numeric as spend,
      count(distinct cm.campaign_id) filter (where not is_non_event(cm.campaign_name) and (cm.spend_aed>0 or cm.meta_leads>0))::bigint as event_campaigns,
      count(distinct cm.campaign_id) filter (where is_non_event(cm.campaign_name) and (cm.spend_aed>0 or cm.meta_leads>0))::bigint as non_event_campaigns
    from v_campaign_month cm, b where cm.month = b.m
  ),
  rv as (
    select coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings
    from sf_bookings sb join sf_leads sl on sl.id = sb.lead_id, b
    where sb.booked_at>=b.p_from and sb.booked_at<b.p_to
  ),
  ld as (select count(*)::bigint leads from sf_leads sl, b where sl.created_date>=b.p_from and sl.created_date<b.p_to)
  select round(sp.spend,2), round(rv.revenue,2), round(rv.revenue-sp.spend,2),
    case when sp.spend>0 then round(rv.revenue/sp.spend,4) else 0 end, ld.leads, rv.bookings, sp.event_campaigns, sp.non_event_campaigns
  from sp, rv, ld;
$$;

create or replace function dashboard_perf_monthly_trend(p_months int default 12)
returns table (month text, spend numeric, revenue numeric, pnl numeric)
language sql stable as $$
  with b as (
    select (date_trunc('month', now()) - make_interval(months => greatest(p_months-1,0)))::date as from_m
  ),
  sp as (select cm.month, sum(cm.spend_aed)::numeric as spend from v_campaign_month cm, b where cm.month >= b.from_m group by cm.month),
  rv as (
    select date_trunc('month', sb.booked_at)::date as month, sum(sb.net_commission)::numeric as revenue
    from sf_bookings sb join sf_leads sl on sl.id = sb.lead_id, b
    where sb.booked_at >= b.from_m
    group by date_trunc('month', sb.booked_at)
  ),
  months as (select month from sp union select month from rv)
  select to_char(m.month,'YYYY-MM'),
    round(coalesce(sp.spend,0),2), round(coalesce(rv.revenue,0),2),
    round(coalesce(rv.revenue,0) - coalesce(sp.spend,0),2)
  from months m left join sp on sp.month = m.month left join rv on rv.month = m.month
  order by m.month asc;
$$;
