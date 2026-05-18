-- Row-level security. The app uses the service-role key on the server for sync,
-- and authenticated user reads via RLS in the client. Single-workspace model:
-- any signed-in user sees the shared data. Tighten to per-user later if needed.

alter table meta_ad_accounts        enable row level security;
alter table meta_campaigns          enable row level security;
alter table meta_lead_forms         enable row level security;
alter table meta_form_insights      enable row level security;
alter table salesforce_connections  enable row level security;
alter table sf_teams                enable row level security;
alter table sf_agents               enable row level security;
alter table sf_leads                enable row level security;
alter table sf_bookings             enable row level security;
alter table sync_jobs               enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'meta_ad_accounts','meta_campaigns','meta_lead_forms','meta_form_insights',
    'salesforce_connections','sf_teams','sf_agents','sf_leads','sf_bookings','sync_jobs'
  ]) loop
    execute format('drop policy if exists "auth_read" on %I;', t);
    execute format('create policy "auth_read" on %I for select to authenticated using (true);', t);
  end loop;
end $$;
