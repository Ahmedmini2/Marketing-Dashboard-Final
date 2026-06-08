-- =========================================================================
-- 0008 — Precise Event / Non-Event classifier
--
-- The earlier `lower(name) like '%non%'` substring test mis-classified any
-- campaign whose name merely CONTAINS "non" (e.g. "…Lebanon Team", "Canon…")
-- as non-event. Replace it everywhere with is_non_event(), which matches the
-- real "non event" / "non-event" / "non_event" token.
-- =========================================================================

create or replace function is_non_event(p_name text) returns boolean
language sql immutable as $$ select lower(coalesce(p_name,'')) ~ 'non[ _-]*event' $$;

-- Home breakdown ----------------------------------------------------------
create or replace function dashboard_home_breakdown(p_from date, p_to date)
returns table (account_id text, account_name text, currency text, event_type text, spend_aed numeric, leads bigint)
language sql stable as $$
  select c.ad_account_id, coalesce(a.name, c.ad_account_id), a.currency,
    case when is_non_event(c.name) then 'non_event' else 'event' end as event_type,
    round(case when upper(coalesce(a.currency,'AED'))='USD' then sum(d.spend)*3.67 else sum(d.spend) end::numeric, 2),
    coalesce(sum(d.leads),0)::bigint
  from meta_campaign_daily d
  join meta_campaigns c on c.id = d.campaign_id
  left join meta_ad_accounts a on a.id = c.ad_account_id
  where d.date >= p_from and d.date <= p_to
  group by c.ad_account_id, a.name, a.currency, case when is_non_event(c.name) then 'non_event' else 'event' end;
$$;

-- Current-month event/non-event campaign counts ---------------------------
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
  rv as (select coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings from sf_bookings sb, b where sb.booked_at>=b.p_from and sb.booked_at<b.p_to),
  ld as (select count(*)::bigint leads from sf_leads sl, b where sl.created_date>=b.p_from and sl.created_date<b.p_to)
  select round(sp.spend,2), round(rv.revenue,2), round(rv.revenue-sp.spend,2),
    case when sp.spend>0 then round(rv.revenue/sp.spend,4) else 0 end, ld.leads, rv.bookings, sp.event_campaigns, sp.non_event_campaigns
  from sp, rv, ld;
$$;

-- Top campaigns this month ------------------------------------------------
create or replace function dashboard_perf_top_campaigns(p_year int, p_month int, p_limit int default 10)
returns table (campaign_name text, event_type text, spend numeric, revenue numeric, pnl numeric, roas numeric, leads bigint)
language sql stable as $$
  with b as (select make_timestamptz(p_year,p_month,1,0,0,0) as p_from, (make_timestamptz(p_year,p_month,1,0,0,0)+interval '1 month') as p_to, make_date(p_year,p_month,1) as m),
  sp as (select cm.campaign_id, cm.campaign_name, cm.spend_aed as spend from v_campaign_month cm, b where cm.month=b.m),
  ld as (select la.primary_campaign_id campaign_id, count(*)::bigint leads from lead_attribution la, b where la.created_date>=b.p_from and la.created_date<b.p_to and la.primary_campaign_id is not null group by la.primary_campaign_id),
  rv as (select la.primary_campaign_id campaign_id, coalesce(sum(sb.net_commission),0)::numeric revenue from sf_bookings sb join lead_attribution la on la.lead_id=sb.lead_id, b where sb.booked_at>=b.p_from and sb.booked_at<b.p_to and la.primary_campaign_id is not null group by la.primary_campaign_id),
  merged as (
    select coalesce(sp.campaign_id, ld.campaign_id, rv.campaign_id) campaign_id,
      coalesce(sp.campaign_name, mc.name, '(unknown)') campaign_name,
      coalesce(sp.spend,0)::numeric spend, coalesce(rv.revenue,0)::numeric revenue, coalesce(ld.leads,0)::bigint leads
    from sp full join ld on ld.campaign_id=sp.campaign_id full join rv on rv.campaign_id=coalesce(sp.campaign_id, ld.campaign_id)
    left join meta_campaigns mc on mc.id=coalesce(sp.campaign_id, ld.campaign_id, rv.campaign_id))
  select campaign_name, case when is_non_event(campaign_name) then 'non_event' else 'event' end,
    round(spend,2), round(revenue,2), round(revenue-spend,2),
    case when spend>0 then round(revenue/spend,4) else 0 end, leads
  from merged where spend>0 or leads>0 or revenue>0 order by (revenue-spend) desc, revenue desc limit p_limit;
$$;

-- Account → campaigns -----------------------------------------------------
create or replace function dashboard_account_campaigns(p_account_id text, p_from timestamptz, p_to timestamptz)
returns table (campaign_id text, campaign_name text, status text, event_type text, spend numeric, meta_leads bigint, sf_leads bigint, bookings bigint, revenue numeric, pnl numeric, roas numeric, cpl numeric)
language sql stable as $$
  with b as (select date_trunc('month',p_from)::date as m_lo, date_trunc('month',p_to)::date as m_hi, date_trunc('month',p_from) as ts_lo, (date_trunc('month',p_to)+interval '1 month') as ts_hi),
  sp as (select cm.campaign_id, cm.campaign_name, sum(cm.spend_aed)::numeric as spend, sum(cm.meta_leads)::bigint as meta_leads
         from v_campaign_month cm, b where cm.account_id=p_account_id and cm.month>=b.m_lo and cm.month<=b.m_hi group by cm.campaign_id, cm.campaign_name),
  ld as (select la.primary_campaign_id as campaign_id, count(*)::bigint as sf_leads from lead_attribution la, b where la.account_id=p_account_id and la.created_date>=b.ts_lo and la.created_date<b.ts_hi and la.primary_campaign_id is not null group by la.primary_campaign_id),
  rv as (select la.primary_campaign_id as campaign_id, coalesce(sum(sb.net_commission),0)::numeric as revenue, count(*)::bigint as bookings from sf_bookings sb join lead_attribution la on la.lead_id=sb.lead_id, b where la.account_id=p_account_id and sb.booked_at>=b.ts_lo and sb.booked_at<b.ts_hi and la.primary_campaign_id is not null group by la.primary_campaign_id),
  ids as (select campaign_id from sp union select campaign_id from ld union select campaign_id from rv)
  select i.campaign_id, coalesce(sp.campaign_name, mc.name, '(unknown)'), mc.status,
    case when is_non_event(coalesce(sp.campaign_name, mc.name)) then 'non_event' else 'event' end,
    round(coalesce(sp.spend,0),2), coalesce(sp.meta_leads,0)::bigint, coalesce(ld.sf_leads,0)::bigint,
    coalesce(rv.bookings,0)::bigint, round(coalesce(rv.revenue,0),2), round(coalesce(rv.revenue,0)-coalesce(sp.spend,0),2),
    case when coalesce(sp.spend,0)>0 then round(coalesce(rv.revenue,0)/sp.spend,4) else 0 end,
    case when coalesce(ld.sf_leads,0)>0 then round(coalesce(sp.spend,0)/ld.sf_leads,2) else 0 end
  from ids i left join sp on sp.campaign_id=i.campaign_id left join ld on ld.campaign_id=i.campaign_id left join rv on rv.campaign_id=i.campaign_id left join meta_campaigns mc on mc.id=i.campaign_id
  where coalesce(sp.spend,0)>0 or coalesce(ld.sf_leads,0)>0 or coalesce(rv.revenue,0)>0
  order by round(coalesce(sp.spend,0),2) desc, round(coalesce(rv.revenue,0),2) desc;
$$;

-- Performance (month × campaign) ------------------------------------------
create or replace function dashboard_performance(p_from timestamptz, p_to timestamptz)
returns table (month text, campaign_name text, event_type text, spend numeric, leads bigint, cpl numeric, unit_price numeric, gross_commission numeric, net_commission numeric, pnl numeric, roi numeric)
language sql stable as $$
  with b as (select date_trunc('month',p_from)::date as m_lo, date_trunc('month',p_to)::date as m_hi, date_trunc('month',p_from) as ts_lo, (date_trunc('month',p_to)+interval '1 month') as ts_hi),
  sp as (select cm.campaign_id as cid, cm.campaign_name, cm.month, cm.spend_aed as spend from v_campaign_month cm, b where cm.month>=b.m_lo and cm.month<=b.m_hi),
  ld as (select coalesce(la.primary_campaign_id,'(none)') as cid, date_trunc('month',la.created_date)::date as month, count(*)::bigint as leads from lead_attribution la, b where la.created_date>=b.ts_lo and la.created_date<b.ts_hi group by 1,2),
  bk as (select coalesce(la.primary_campaign_id,'(none)') as cid, date_trunc('month',sb.booked_at)::date as month, sum(sb.sale_amount)::numeric as unit_price, sum(sb.gross_commission)::numeric as gross_commission, sum(sb.net_commission)::numeric as net_commission from sf_bookings sb left join lead_attribution la on la.lead_id=sb.lead_id, b where sb.booked_at>=b.ts_lo and sb.booked_at<b.ts_hi group by 1,2),
  keys as (select coalesce(cid,'(none)') as cid, month from sp union select cid, month from ld union select cid, month from bk)
  select to_char(k.month,'YYYY-MM'),
    case when k.cid='(none)' then '(unattributed)' else coalesce(mc.name, sp.campaign_name, '(unknown)') end,
    case when is_non_event(coalesce(mc.name, sp.campaign_name)) then 'non_event' else 'event' end,
    round(coalesce(sp.spend,0),2), coalesce(ld.leads,0)::bigint,
    case when coalesce(ld.leads,0)>0 then round(coalesce(sp.spend,0)/ld.leads,2) else 0 end,
    round(coalesce(bk.unit_price,0),2), round(coalesce(bk.gross_commission,0),2), round(coalesce(bk.net_commission,0),2),
    round(coalesce(bk.net_commission,0)-coalesce(sp.spend,0),2),
    case when coalesce(sp.spend,0)>0 then round((coalesce(bk.net_commission,0)-sp.spend)/sp.spend,4) else 0 end
  from keys k left join sp on coalesce(sp.cid,'(none)')=k.cid and sp.month=k.month left join ld on ld.cid=k.cid and ld.month=k.month left join bk on bk.cid=k.cid and bk.month=k.month left join meta_campaigns mc on mc.id=k.cid and k.cid<>'(none)'
  where coalesce(sp.spend,0)>0 or coalesce(ld.leads,0)>0 or coalesce(bk.net_commission,0)<>0
  order by k.month desc, coalesce(sp.spend,0) desc;
$$;
