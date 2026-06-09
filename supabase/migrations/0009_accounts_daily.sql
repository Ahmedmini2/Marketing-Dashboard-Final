-- =========================================================================
-- 0009 — Day-precision Accounts RPCs
--
-- The existing dashboard_accounts / dashboard_account_campaigns are month-
-- aligned (spend lives in v_campaign_month), so a 7D / 10D / 14D range would
-- expand to the whole containing months. These _daily variants read from
-- meta_campaign_daily for true day-precision spend (and matching day-precision
-- timestamp filters on leads/revenue), so the Accounts page can honour the
-- short presets on the date filter.
--
-- The page falls back to the monthly RPCs for ranges outside the 180-day
-- daily window (i.e. the "All" preset).
-- =========================================================================

create or replace function dashboard_accounts_daily(p_from date, p_to date)
returns table (
  account_id text, account_name text, currency text,
  spend numeric, revenue numeric, pnl numeric, roas numeric,
  leads bigint, bookings bigint, campaigns bigint, accessible boolean
)
language sql stable as $$
  with sp as (
    select
      c.ad_account_id as account_id,
      sum(case when upper(coalesce(a.currency,'AED'))='USD' then d.spend*3.67 else d.spend end)::numeric as spend,
      count(distinct d.campaign_id) filter (where d.spend>0 or d.leads>0) as campaigns
    from meta_campaign_daily d
    join meta_campaigns c on c.id = d.campaign_id
    left join meta_ad_accounts a on a.id = c.ad_account_id
    where d.date >= p_from and d.date <= p_to
    group by c.ad_account_id
  ),
  ld as (
    select la.account_id, count(*)::bigint leads
    from lead_attribution la
    where la.created_date >= p_from::timestamptz
      and la.created_date <  (p_to::timestamptz + interval '1 day')
      and la.account_id is not null
    group by la.account_id
  ),
  rv as (
    select la.account_id, coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings
    from sf_bookings sb
    join lead_attribution la on la.lead_id = sb.lead_id
    where sb.booked_at >= p_from::timestamptz
      and sb.booked_at <  (p_to::timestamptz + interval '1 day')
      and la.account_id is not null
    group by la.account_id
  )
  select
    acct.id, acct.name, acct.currency,
    round(coalesce(sp.spend,0),2),
    round(coalesce(rv.revenue,0),2),
    round(coalesce(rv.revenue,0) - coalesce(sp.spend,0),2),
    case when coalesce(sp.spend,0)>0 then round(coalesce(rv.revenue,0)/sp.spend,4) else 0 end,
    coalesce(ld.leads,0)::bigint, coalesce(rv.bookings,0)::bigint, coalesce(sp.campaigns,0)::bigint,
    (acct.currency is not null or coalesce(sp.campaigns,0)>0)
  from meta_ad_accounts acct
  left join sp on sp.account_id = acct.id
  left join ld on ld.account_id = acct.id
  left join rv on rv.account_id = acct.id
  order by round(coalesce(sp.spend,0),2) desc;
$$;

create or replace function dashboard_account_campaigns_daily(p_account_id text, p_from date, p_to date)
returns table (
  campaign_id text, campaign_name text, status text, event_type text,
  spend numeric, meta_leads bigint, sf_leads bigint, bookings bigint,
  revenue numeric, pnl numeric, roas numeric, cpl numeric
)
language sql stable as $$
  with sp as (
    select d.campaign_id, c.name as campaign_name,
      sum(case when upper(coalesce(a.currency,'AED'))='USD' then d.spend*3.67 else d.spend end)::numeric as spend,
      sum(d.leads)::bigint as meta_leads
    from meta_campaign_daily d
    join meta_campaigns c on c.id = d.campaign_id
    left join meta_ad_accounts a on a.id = c.ad_account_id
    where c.ad_account_id = p_account_id and d.date >= p_from and d.date <= p_to
    group by d.campaign_id, c.name
  ),
  ld as (
    select la.primary_campaign_id campaign_id, count(*)::bigint sf_leads
    from lead_attribution la
    where la.account_id = p_account_id
      and la.created_date >= p_from::timestamptz
      and la.created_date <  (p_to::timestamptz + interval '1 day')
      and la.primary_campaign_id is not null
    group by la.primary_campaign_id
  ),
  rv as (
    select la.primary_campaign_id campaign_id, coalesce(sum(sb.net_commission),0)::numeric revenue, count(*)::bigint bookings
    from sf_bookings sb
    join lead_attribution la on la.lead_id = sb.lead_id
    where la.account_id = p_account_id
      and sb.booked_at >= p_from::timestamptz
      and sb.booked_at <  (p_to::timestamptz + interval '1 day')
      and la.primary_campaign_id is not null
    group by la.primary_campaign_id
  ),
  ids as (select campaign_id from sp union select campaign_id from ld union select campaign_id from rv)
  select i.campaign_id, coalesce(sp.campaign_name, mc.name, '(unknown)'), mc.status,
    case when is_non_event(coalesce(sp.campaign_name, mc.name)) then 'non_event' else 'event' end,
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
