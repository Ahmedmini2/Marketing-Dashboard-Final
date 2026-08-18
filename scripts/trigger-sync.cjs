// Scheduled-sync trigger for a Railway cron service.
//
// The cron block in vercel.json only ever fired on Vercel, so on Railway this
// app has had no scheduled sync at all — every run in sync_jobs was a manual
// "Sync now" click. This script is the replacement: point a Railway cron
// service at it and it hits /api/cron/sync with SYNC_SECRET.
//
// /api/cron/sync returns 202 immediately (a full sync takes 9–17 minutes and no
// longer blocks a request), so this then polls /api/sync/status until the job
// reaches a terminal state. That way the Railway run's duration, logs, and exit
// code reflect the actual sync rather than just the fact that it was accepted.
//
//   node scripts/trigger-sync.cjs
//
// Env (Railway service variables):
//   APP_URL      — public URL of the dashboard, e.g. https://your-app.up.railway.app
//   SYNC_SECRET  — must match the dashboard's SYNC_SECRET
//
// Falls back to reading .env.local so it can be run locally for a smoke test.

const fs = require("fs");
const path = require("path");

function env(k) {
  if (process.env[k]) return process.env[k].trim();
  try {
    const txt = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
    const m = txt.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

const POLL_MS = 30_000;
const MAX_WAIT_MS = 45 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

/** Read a response without assuming it is JSON — a proxy error is plain text. */
async function readJson(res) {
  const text = await res.text().catch(() => "");
  try {
    return { data: JSON.parse(text), raw: text };
  } catch {
    return { data: null, raw: text };
  }
}

async function main() {
  const appUrl = (env("APP_URL") || "").replace(/\/+$/, "");
  const secret = env("SYNC_SECRET");

  if (!appUrl) throw new Error("APP_URL is not set");
  if (!secret) throw new Error("SYNC_SECRET is not set");
  if (appUrl.includes("localhost")) {
    console.warn(`[${stamp()}] warning: APP_URL points at localhost — set the public Railway URL`);
  }

  const auth = { authorization: `Bearer ${secret}` };

  console.log(`[${stamp()}] triggering sync at ${appUrl}`);
  const res = await fetch(`${appUrl}/api/cron/sync`, { headers: auth });
  const { data, raw } = await readJson(res);

  if (!res.ok && res.status !== 202) {
    throw new Error(`trigger failed: HTTP ${res.status} — ${raw.trim().slice(0, 200)}`);
  }
  if (!data || !data.jobId) {
    throw new Error(`trigger returned no job id — ${raw.trim().slice(0, 200)}`);
  }

  const { jobId, alreadyRunning } = data;
  console.log(`[${stamp()}] job ${jobId}${alreadyRunning ? " (joined a sync already in flight)" : ""}`);

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);

    let job;
    try {
      const s = await fetch(`${appUrl}/api/sync/status?id=${encodeURIComponent(jobId)}`, {
        headers: auth,
      });
      const parsed = await readJson(s);
      job = parsed.data && parsed.data.job;
    } catch (e) {
      // A blip polling the status endpoint says nothing about the sync, which
      // runs independently on the server. Keep waiting.
      console.warn(`[${stamp()}] status check failed (${e.message}) — retrying`);
      continue;
    }

    if (!job) {
      console.warn(`[${stamp()}] job not found yet — retrying`);
      continue;
    }

    if (job.status === "running") {
      console.log(`[${stamp()}] still running (${job.elapsedSeconds}s)`);
      continue;
    }

    if (job.status === "success") {
      console.log(`[${stamp()}] success in ${job.elapsedSeconds}s — ${JSON.stringify(job.stats)}`);
      return;
    }

    throw new Error(
      `sync finished with errors after ${job.elapsedSeconds}s: ${JSON.stringify(job.errors)}`
    );
  }

  throw new Error(`gave up waiting after ${MAX_WAIT_MS / 60000} minutes (the sync may still be running)`);
}

main().catch((e) => {
  console.error(`[${stamp()}] ${e.message}`);
  process.exit(1);
});
