-- =========================================================================
-- Performance dashboard v2: summary cards, current-month stats, top agents,
-- top campaigns, and monthly trend. All RPCs share the same definitions of
-- spend / revenue / pnl / roas as dashboard_performance:
--
--   spend   = sum(attributed_spend)              -- from lead_attribution
--   revenue = sum(net_commission)                -- Allegiance share
--   pnl     = revenue - spend
--   roas    = revenue / spend                    -- ratio (1.5 = 1.5x)
--
-- "event" / "non_event" classification: campaign_name matches '%non%' → non_event,
-- otherwise event. (Matches dashboard_performance.)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Totals across a date window (used for the 4 hero cards: all-time view)
-- -------------------------------------------------------------------------
create or replace function dashboard_perf_summary(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  spend    numeric,
  revenue  numeric,
  pnl      numeric,
  roas     numeric,
  leads    bigint,
  bookings bigint
)
language sql
stable
as $$
  with booking_agg as (
    select
      lead_id,
      sum(net_commission)::numeric as net_commission,
      count(*)::bigint            as bookings_count
    from sf_bookings
    group by lead_id
  ),
  lead_rows as (
    select
      la.attributed_spend::numeric              as spend,
      coalesce(ba.net_commission, 0)::numeric   as revenue,
      coalesce(ba.bookings_count, 0)::bigint    as bookings_count
    from lead_attribution la
    left join booking_agg ba on ba.lead_id = la.lead_id
    where la.created_date >= p_from
      and la.created_date <= p_to
  )
  select
    round(coalesce(sum(spend),   0), 2) as spend,
    round(coalesce(sum(revenue), 0), 2) as revenue,
    round(coalesce(sum(revenue) - sum(spend), 0), 2) as pnl,
    case when coalesce(sum(spend), 0) > 0
         then round((sum(revenue) / sum(spend))::numeric, 4)
         else 0::numeric end                   as roas,
    count(*)::bigint                           as leads,
    coalesce(sum(bookings_count), 0)::bigint   as bookings
  from lead_rows
$$;

-- -------------------------------------------------------------------------
-- 2. Current-month statistics (spend, revenue, P&L, ROAS, event split)
-- -------------------------------------------------------------------------
create or replace function dashboard_perf_month_stats(
  p_year  int,
  p_month int
)
returns table (
  spend                  numeric,
  revenue                numeric,
  pnl                    numeric,
  roas                   numeric,
  leads                  bigint,
  bookings               bigint,
  event_campaigns        bigint,
  non_event_campaigns    bigint
)
language sql
stable
as $$
  with bounds as (
    select
      make_timestamptz(p_year, p_month, 1, 0, 0, 0)                          as p_from,
      (make_timestamptz(p_year, p_month, 1, 0, 0, 0) + interval '1 month')   as p_to
  ),
  booking_agg as (
    select lead_id,
           sum(net_commission)::numeric as net_commission,
           count(*)::bigint            as bookings_count
    from sf_bookings
    group by lead_id
  ),
  lead_rows as (
    select
      coalesce(la.campaign_name, '(unknown)') as campaign_name,
      case when lower(coalesce(la.campaign_name, '')) like '%non%'
           then 'non_event' else 'event' end  as event_type,
      la.attributed_spend::numeric            as spend,
      coalesce(ba.net_commission, 0)::numeric as revenue,
      coalesce(ba.bookings_count, 0)::bigint  as bookings_count
    from lead_attribution la
    left join booking_agg ba on ba.lead_id = la.lead_id
    cross join bounds b
    where la.created_date >= b.p_from
      and la.created_date <  b.p_to
  )
  select
    round(coalesce(sum(spend),   0), 2)                                   as spend,
    round(coalesce(sum(revenue), 0), 2)                                   as revenue,
    round(coalesce(sum(revenue) - sum(spend), 0), 2)                      as pnl,
    case when coalesce(sum(spend), 0) > 0
         then round((sum(revenue) / sum(spend))::numeric, 4)
         else 0::numeric end                                              as roas,
    count(*)::bigint                                                      as leads,
    coalesce(sum(bookings_count), 0)::bigint                              as bookings,
    count(distinct campaign_name) filter (where event_type = 'event')     as event_campaigns,
    count(distinct campaign_name) filter (where event_type = 'non_event') as non_event_campaigns
  from lead_rows
$$;

-- -------------------------------------------------------------------------
-- 3. Top agents this month, ranked by bookings ("BNL") then revenue
-- -------------------------------------------------------------------------
create or replace function dashboard_perf_top_agents(
  p_year  int,
  p_month int,
  p_limit int default 10
)
returns table (
  agent_id   text,
  agent_name text,
  team_name  text,
  bookings   bigint,
  revenue    numeric,
  leads      bigint
)
language sql
stable
as $$
  with bounds as (
    select
      make_timestamptz(p_year, p_month, 1, 0, 0, 0)                          as p_from,
      (make_timestamptz(p_year, p_month, 1, 0, 0, 0) + interval '1 month')   as p_to
  ),
  booked_in_month as (
    select
      b.agent_id,
      sum(b.net_commission)::numeric  as revenue,
      count(*)::bigint                as bookings
    from sf_bookings b
    cross join bounds bn
    where b.booked_at >= bn.p_from
      and b.booked_at <  bn.p_to
      and b.agent_id is not null
    group by b.agent_id
  ),
  leads_in_month as (
    select l.agent_id, count(*)::bigint as leads
    from sf_leads l
    cross join bounds bn
    where l.created_date >= bn.p_from
      and l.created_date <  bn.p_to
      and l.agent_id is not null
    group by l.agent_id
  )
  select
    a.id                                  as agent_id,
    a.name                                as agent_name,
    t.name                                as team_name,
    coalesce(bk.bookings, 0)::bigint      as bookings,
    round(coalesce(bk.revenue,  0), 2)    as revenue,
    coalesce(lm.leads, 0)::bigint         as leads
  from sf_agents a
  left join booked_in_month bk on bk.agent_id = a.id
  left join leads_in_month   lm on lm.agent_id = a.id
  left join sf_teams         t  on t.id        = a.team_id
  where coalesce(bk.bookings, 0) > 0
     or coalesce(lm.leads,    0) > 0
  order by bookings desc, revenue desc, leads desc
  limit p_limit
$$;

-- -------------------------------------------------------------------------
-- 4. Best-performing campaigns this month, ranked by P&L
-- -------------------------------------------------------------------------
create or replace function dashboard_perf_top_campaigns(
  p_year  int,
  p_month int,
  p_limit int default 10
)
returns table (
  campaign_name text,
  event_type    text,
  spend         numeric,
  revenue       numeric,
  pnl           numeric,
  roas          numeric,
  leads         bigint
)
language sql
stable
as $$
  with bounds as (
    select
      make_timestamptz(p_year, p_month, 1, 0, 0, 0)                          as p_from,
      (make_timestamptz(p_year, p_month, 1, 0, 0, 0) + interval '1 month')   as p_to
  ),
  booking_agg as (
    select lead_id, sum(net_commission)::numeric as net_commission
    from sf_bookings group by lead_id
  ),
  lead_rows as (
    select
      coalesce(la.campaign_name, '(unknown)')   as campaign_name,
      case when lower(coalesce(la.campaign_name, '')) like '%non%'
           then 'non_event' else 'event' end    as event_type,
      la.attributed_spend::numeric              as spend,
      coalesce(ba.net_commission, 0)::numeric   as revenue
    from lead_attribution la
    left join booking_agg ba on ba.lead_id = la.lead_id
    cross join bounds b
    where la.created_date >= b.p_from
      and la.created_date <  b.p_to
  )
  select
    campaign_name,
    max(event_type)                                                 as event_type,
    round(sum(spend)::numeric,   2)                                 as spend,
    round(sum(revenue)::numeric, 2)                                 as revenue,
    round((sum(revenue) - sum(spend))::numeric, 2)                  as pnl,
    case when sum(spend) > 0
         then round((sum(revenue) / sum(spend))::numeric, 4)
         else 0::numeric end                                        as roas,
    count(*)::bigint                                                as leads
  from lead_rows
  group by campaign_name
  order by pnl desc, revenue desc
  limit p_limit
$$;

-- -------------------------------------------------------------------------
-- 5. Monthly trend — last N months (for the trend chart)
-- -------------------------------------------------------------------------
create or replace function dashboard_perf_monthly_trend(
  p_months int default 12
)
returns table (
  month   text,
  spend   numeric,
  revenue numeric,
  pnl     numeric
)
language sql
stable
as $$
  with bounds as (
    select
      date_trunc('month', now()) - make_interval(months => greatest(p_months - 1, 0))
        as p_from,
      date_trunc('month', now()) + interval '1 month'
        as p_to
  ),
  booking_agg as (
    select lead_id, sum(net_commission)::numeric as net_commission
    from sf_bookings group by lead_id
  ),
  lead_rows as (
    select
      to_char(date_trunc('month', la.created_date), 'YYYY-MM') as month,
      la.attributed_spend::numeric                              as spend,
      coalesce(ba.net_commission, 0)::numeric                   as revenue
    from lead_attribution la
    left join booking_agg ba on ba.lead_id = la.lead_id
    cross join bounds b
    where la.created_date >= b.p_from
      and la.created_date <  b.p_to
  )
  select
    month,
    round(sum(spend)::numeric,   2)                  as spend,
    round(sum(revenue)::numeric, 2)                  as revenue,
    round((sum(revenue) - sum(spend))::numeric, 2)   as pnl
  from lead_rows
  group by month
  order by month asc
$$;
