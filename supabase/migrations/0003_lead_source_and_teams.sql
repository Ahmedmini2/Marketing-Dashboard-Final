-- Add lead_source to sf_leads + record the manager (team) name on sf_teams when
-- it comes from User.Manager (instead of the Group table).

alter table sf_leads add column if not exists lead_source text;
create index if not exists idx_sf_leads_source on sf_leads(lower(lead_source));

-- sf_teams already has (id, name) — no schema change needed; manager Id goes
-- in as id, manager's Name as name. Just leaving a note.
