-- Marketing Dashboard initial schema
-- Run via: supabase db push  (or paste into Supabase SQL editor)

create extension if not exists "pgcrypto";

-- =========================================================================
-- META (Facebook/Instagram Ads) -------------------------------------------
-- =========================================================================
create table if not exists meta_ad_accounts (
  id              text primary key,            -- e.g. "act_1234567890"
  user_id         uuid references auth.users on delete cascade,
  name            text,
  currency        text,
  timezone        text,
  access_token    text,                        -- long-lived user/system-user token
  connected_at    timestamptz default now(),
  last_synced_at  timestamptz
);

create table if not exists meta_campaigns (
  id              text primary key,            -- Meta campaign id
  ad_account_id   text references meta_ad_accounts(id) on delete cascade,
  name            text not null,
  objective       text,
  status          text,
  created_time    timestamptz,
  updated_at      timestamptz default now()
);

create index if not exists idx_meta_campaigns_account on meta_campaigns(ad_account_id);

create table if not exists meta_lead_forms (
  id              text primary key,            -- Meta lead form id
  ad_account_id   text references meta_ad_accounts(id) on delete cascade,
  page_id         text,
  name            text not null,               -- THIS is what we match Salesforce campaign_name against
  status          text,
  created_time    timestamptz,
  updated_at      timestamptz default now()
);

create index if not exists idx_meta_lead_forms_name on meta_lead_forms(lower(name));

-- Daily roll-up: spend / impressions / leads per (form, campaign, date).
create table if not exists meta_form_insights (
  id              bigserial primary key,
  form_id         text references meta_lead_forms(id) on delete cascade,
  campaign_id     text references meta_campaigns(id) on delete cascade,
  date            date not null,
  spend           numeric(14,2) default 0,
  impressions    integer default 0,
  clicks          integer default 0,
  leads           integer default 0,
  unique (form_id, campaign_id, date)
);

create index if not exists idx_meta_form_insights_date on meta_form_insights(date);

-- =========================================================================
-- SALESFORCE -------------------------------------------------------------
-- =========================================================================
create table if not exists salesforce_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users on delete cascade,
  instance_url    text not null,
  access_token    text,
  refresh_token   text,
  expires_at      timestamptz,
  connected_at    timestamptz default now(),
  last_synced_at  timestamptz
);

create table if not exists sf_teams (
  id              text primary key,            -- SF group/team id (or synthetic)
  name            text not null,
  updated_at      timestamptz default now()
);

create table if not exists sf_agents (
  id              text primary key,            -- SF User Id
  name            text not null,
  email           text,
  team_id         text references sf_teams(id) on delete set null,
  updated_at      timestamptz default now()
);

create table if not exists sf_leads (
  id              text primary key,            -- SF Lead Id
  campaign_name   text,                        -- raw campaign name from SF — matched to meta_lead_forms.name
  agent_id        text references sf_agents(id) on delete set null,
  status          text,
  created_date    timestamptz,
  updated_at      timestamptz default now()
);

create index if not exists idx_sf_leads_campaign_name on sf_leads(lower(campaign_name));
create index if not exists idx_sf_leads_agent on sf_leads(agent_id);
create index if not exists idx_sf_leads_created on sf_leads(created_date);

create table if not exists sf_bookings (
  id              text primary key,            -- SF Opportunity / Booking Id
  lead_id         text references sf_leads(id) on delete set null,
  agent_id        text references sf_agents(id) on delete set null,
  sale_amount     numeric(14,2) default 0,
  booked_at       timestamptz,
  status          text,
  updated_at      timestamptz default now()
);

create index if not exists idx_sf_bookings_lead on sf_bookings(lead_id);
create index if not exists idx_sf_bookings_agent on sf_bookings(agent_id);
create index if not exists idx_sf_bookings_at on sf_bookings(booked_at);

-- =========================================================================
-- SYNC LOG ---------------------------------------------------------------
-- =========================================================================
create table if not exists sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users on delete set null,
  source          text not null check (source in ('meta','salesforce','all')),
  status          text not null default 'running' check (status in ('running','success','error')),
  started_at      timestamptz default now(),
  finished_at     timestamptz,
  error           text,
  stats           jsonb
);

create index if not exists idx_sync_jobs_started on sync_jobs(started_at desc);

-- =========================================================================
-- ATTRIBUTION VIEW -------------------------------------------------------
-- For each lead, work out spend share = form_spend / form_total_leads.
-- Join bookings to get revenue. This is the workhorse used by the dashboard.
-- =========================================================================
create or replace view v_form_totals as
select
  f.id                       as form_id,
  f.name                     as form_name,
  coalesce(sum(i.spend),0)   as total_spend,
  coalesce(sum(i.leads),0)   as meta_leads,
  min(i.date)                as first_date,
  max(i.date)                as last_date
from meta_lead_forms f
left join meta_form_insights i on i.form_id = f.id
group by f.id, f.name;

-- One row per Salesforce lead with attributed spend + booked revenue.
create or replace view v_lead_attribution as
with form_match as (
  select
    l.id              as lead_id,
    l.campaign_name,
    l.agent_id,
    l.status          as lead_status,
    l.created_date,
    f.id              as form_id,
    f.name            as form_name,
    ft.total_spend,
    ft.meta_leads
  from sf_leads l
  left join meta_lead_forms f on lower(f.name) = lower(l.campaign_name)
  left join v_form_totals ft   on ft.form_id   = f.id
)
select
  fm.lead_id,
  fm.campaign_name,
  fm.form_id,
  fm.form_name,
  fm.agent_id,
  a.team_id,
  fm.lead_status,
  fm.created_date,
  case
    when coalesce(fm.meta_leads,0) = 0 then 0
    else (fm.total_spend / fm.meta_leads)::numeric(14,2)
  end                                       as attributed_spend,
  coalesce(b.revenue, 0)                    as revenue,
  coalesce(b.bookings_count, 0)             as bookings_count
from form_match fm
left join sf_agents a on a.id = fm.agent_id
left join (
  select lead_id, sum(sale_amount) as revenue, count(*) as bookings_count
  from sf_bookings
  group by lead_id
) b on b.lead_id = fm.lead_id;
