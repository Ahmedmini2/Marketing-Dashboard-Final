-- =========================================================================
-- 0011 — sync_jobs heartbeat + stale-job sweep
--
-- A full sync takes 9–17 minutes (measured across 20+ runs). It used to be
-- awaited inside the POST /api/sync/all request, so Railway's edge proxy cut
-- the client connection long before the work finished and returned the
-- plaintext body `upstream error` — which the dashboard then tried to
-- JSON.parse, surfacing "Unexpected token 'u'" as the sync status.
--
-- The sync now runs detached from the request and the UI polls this table.
-- That makes one new failure mode possible: if the container restarts or is
-- redeployed mid-sync, nothing is left to write the terminal status and the
-- row would sit at 'running' forever (there were two such orphans, the oldest
-- from 2026-05-20). `heartbeat_at` is refreshed by the runner while it works,
-- so a stalled job is distinguishable from a slow one.
--
-- status stays constrained to ('running','success','error') by 0001, so an
-- abandoned job is recorded as 'error' with an explanatory `error` string
-- rather than a new status value.
-- =========================================================================

alter table sync_jobs
  add column if not exists heartbeat_at timestamptz;

-- Backfill. Terminal rows can take their last known activity.
--
-- Rows still marked 'running' are ambiguous — a pre-heartbeat job that is
-- genuinely mid-sync looks identical to one whose runner died — so a row that
-- started within the last hour gets a fresh heartbeat and is judged on the next
-- five minutes rather than condemned retroactively. (This matters: a sync
-- started under the old code is typically 9–17 minutes into real work.)
--
-- The grace is deliberately bounded by started_at. Extending it to every
-- 'running' row would resurrect long-dead orphans — the first cut of this
-- migration did exactly that to a job stranded since 2026-05-20, hiding it from
-- the sweep at the bottom of this file.
update sync_jobs
   set heartbeat_at = case
         when status = 'running' and started_at > now() - interval '1 hour' then now()
         else coalesce(finished_at, started_at)
       end
 where heartbeat_at is null;

alter table sync_jobs
  alter column heartbeat_at set default now();

-- Finding the in-flight job is the hot path for the status endpoint.
create index if not exists idx_sync_jobs_running
  on sync_jobs(status, heartbeat_at desc)
  where status = 'running';

-- =========================================================================
-- sweep_stale_sync_jobs — close out jobs whose runner died.
--
-- p_stale_after should be comfortably larger than the runner's heartbeat
-- interval (15s) to tolerate a slow Meta API call blocking the event loop.
-- Returns the number of jobs closed.
-- =========================================================================
create or replace function sweep_stale_sync_jobs(p_stale_after interval default interval '5 minutes')
returns integer
language plpgsql as $$
declare
  swept integer;
begin
  with stale as (
    update sync_jobs
       set status      = 'error',
           finished_at = coalesce(finished_at, heartbeat_at, started_at),
           error       = coalesce(nullif(error, ''), 'abandoned: no heartbeat for ' || p_stale_after::text
                                  || ' (runner process most likely restarted or was redeployed mid-sync)')
     where status = 'running'
       and coalesce(heartbeat_at, started_at) < now() - p_stale_after
    returning 1
  )
  select count(*)::integer into swept from stale;
  return swept;
end;
$$;

-- Close out the orphans that predate the heartbeat column. One hour is well past
-- the slowest run ever recorded (998s), so anything older is unambiguously dead
-- — and the grace given to in-flight rows above is preserved.
select sweep_stale_sync_jobs(interval '1 hour');
