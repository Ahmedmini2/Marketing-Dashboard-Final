-- Performance dashboard: commission fields + monthly aggregation function
-- Run via: supabase db push  (or paste into Supabase SQL editor)

-- =========================================================================
-- 1. Extend sf_bookings with commission columns
-- =========================================================================
alter table sf_bookings
  add column if not exists gross_commission numeric(14,2) default 0,
  add column if not exists net_commission   numeric(14,2) default 0;

-- =========================================================================
-- 2. dashboard_performance RPC
--
-- Returns one row per (month × campaign_name) within the requested window.
-- event_type = 'non_event' when campaign_name contains 'non' (case-insensitive);
--              'event' otherwise.
--
-- Caller groups these rows by month in JS:
--   parent row  = monthly summary (all campaigns in that month/segment)
--   child rows  = individual campaign breakdowns
--
-- Columns
--   month            – 'YYYY-MM'   (sort/display in app)
--   campaign_name    – raw Salesforce campaign name
--   event_type       – 'event' | 'non_event'
--   spend            – total attributed ad spend (AED, same as v_lead_attribution)
--   leads            – count of leads in the month for this campaign
--   cpl              – cost per lead  = spend / leads
--   unit_price       – sum of Booking_Price__c (sale_amount) for booked leads
--   gross_commission – sum of Gross_Commission__c for booked leads
--   net_commission   – sum of Net_Commission__c  for booked leads (Allegiance share)
--   pnl              – net_commission − spend
--   roi              – pnl / spend  (decimal: 0.5 = 50 %)
-- =========================================================================
create or replace function dashboard_performance(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  month             text,
  campaign_name     text,
  event_type        text,
  spend             numeric,
  leads             bigint,
  cpl               numeric,
  unit_price        numeric,
  gross_commission  numeric,
  net_commission    numeric,
  pnl               numeric,
  roi               numeric
)
language sql
stable
as $$
  -- Step 1: aggregate bookings per lead (avoid row-multiplication on the join)
  with booking_agg as (
    select
      lead_id,
      sum(sale_amount)      as total_unit_price,
      sum(gross_commission) as total_gross_commission,
      sum(net_commission)   as total_net_commission
    from sf_bookings
    group by lead_id
  ),

  -- Step 2: one row per lead with its attributed spend + booking financials
  lead_data as (
    select
      la.lead_id,
      to_char(date_trunc('month', la.created_date), 'YYYY-MM')   as month,
      coalesce(la.campaign_name, '(unknown)')                      as campaign_name,
      case
        when lower(coalesce(la.campaign_name, '')) like '%non%'
        then 'non_event'
        else 'event'
      end                                                           as event_type,
      la.attributed_spend,
      coalesce(ba.total_unit_price,        0)                      as unit_price,
      coalesce(ba.total_gross_commission,  0)                      as gross_commission,
      coalesce(ba.total_net_commission,    0)                      as net_commission
    from v_lead_attribution la
    left join booking_agg ba on ba.lead_id = la.lead_id
    where la.created_date >= p_from
      and la.created_date <= p_to
  )

  -- Step 3: group to campaign × month level
  select
    month,
    campaign_name,
    event_type,
    round(sum(attributed_spend)::numeric, 2)                       as spend,
    count(*)::bigint                                               as leads,
    case
      when count(*) > 0
      then round((sum(attributed_spend) / count(*))::numeric, 2)
      else 0::numeric
    end                                                             as cpl,
    round(sum(unit_price)::numeric,        2)                      as unit_price,
    round(sum(gross_commission)::numeric,  2)                      as gross_commission,
    round(sum(net_commission)::numeric,    2)                      as net_commission,
    round((sum(net_commission) - sum(attributed_spend))::numeric, 2)
                                                                    as pnl,
    case
      when sum(attributed_spend) > 0
      then round(
             ((sum(net_commission) - sum(attributed_spend))
               / sum(attributed_spend))::numeric,
             4
           )
      else 0::numeric
    end                                                             as roi
  from lead_data
  group by month, campaign_name, event_type
  order by month desc, spend desc
$$;
