import "./home.css";
import { fetchHomeBreakdown } from "@/lib/aggregations";
import { getLastSync } from "@/lib/filter-options";
import { SyncButton } from "@/components/sync-button";
import { HomeDateControls } from "@/components/home/date-controls";
import { DrillCard, type Agg } from "@/components/home/drill-card";

export const dynamic = "force-dynamic";

const z = (): Agg => ({ spend: 0, leads: 0 });
const add = (a: Agg, b: Agg): Agg => ({ spend: a.spend + b.spend, leads: a.leads + b.leads });
const aed0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(n || 0);
const aed2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "AED", maximumFractionDigits: 2 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));
const cplStr = (d: Agg) => (d.leads > 0 ? aed2(d.spend / d.leads) : "—");
// Local YYYY-MM-DD (avoid UTC drift, matching components/home/date-controls).
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v === null) return <span className="delta">— vs prev.</span>;
  const good = invert ? v < 0 : v >= 0;
  return (
    <span className={`delta ${good ? "up" : "down"}`}>
      {v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}% vs prev. period
    </span>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | undefined }>;
}) {
  const sp = await searchParams;
  const days = Math.max(1, Number(sp.days ?? 30) || 30);
  let toStr = sp.to ?? iso(new Date());
  let fromStr =
    sp.from ??
    (() => {
      const d = new Date(toStr);
      d.setDate(d.getDate() - (days - 1));
      return iso(d);
    })();
  // Guard against a reversed range (from > to) — swap so the window is valid.
  if (new Date(fromStr) > new Date(toStr)) [fromStr, toStr] = [toStr, fromStr];
  const fromD = new Date(fromStr);
  const toD = new Date(toStr);
  const len = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);

  // previous equal-length window (immediately preceding)
  const prevToD = new Date(fromD);
  prevToD.setDate(prevToD.getDate() - 1);
  const prevFromD = new Date(prevToD);
  prevFromD.setDate(prevFromD.getDate() - (len - 1));

  const [rows, prevRows, lastSync] = await Promise.all([
    fetchHomeBreakdown(fromStr, toStr),
    fetchHomeBreakdown(iso(prevFromD), iso(prevToD)),
    getLastSync(),
  ]);

  // ---- roll up account × event_type into the four levels ----
  const accMap = new Map<string, { id: string; name: string; event: Agg; nonevent: Agg }>();
  let evAll = z();
  let nevAll = z();
  for (const r of rows) {
    const a = accMap.get(r.account_id) ?? { id: r.account_id, name: r.account_name, event: z(), nonevent: z() };
    const cell = { spend: r.spend, leads: r.leads };
    if (r.event_type === "event") {
      a.event = add(a.event, cell);
      evAll = add(evAll, cell);
    } else {
      a.nonevent = add(a.nonevent, cell);
      nevAll = add(nevAll, cell);
    }
    accMap.set(r.account_id, a);
  }
  const overview = add(evAll, nevAll);
  const prevOverview = prevRows.reduce((acc, r) => add(acc, { spend: r.spend, leads: r.leads }), z());
  const accounts = [...accMap.values()]
    .map((a) => ({ ...a, total: add(a.event, a.nonevent) }))
    .sort((x, y) => y.total.spend - x.total.spend);

  const curCpl = overview.leads > 0 ? overview.spend / overview.leads : 0;
  const prevCpl = prevOverview.leads > 0 ? prevOverview.spend / prevOverview.leads : 0;
  const rangeLabel = `${fromStr} → ${toStr} · ${len} day${len === 1 ? "" : "s"}`;

  return (
    <div className="home-scope">
      {/* Header + date range */}
      <header className="top">
        <div className="brand">
          <div className="eyebrow">Digital Marketing · Performance</div>
          <h1>
            Spend &amp; Lead <span>Dashboard</span>
          </h1>
          <p>Spend, leads and CPL across platforms and ad accounts — Meta-reported leads.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end" }}>
          <SyncButton lastSyncedAt={lastSync} />
          <HomeDateControls />
        </div>
      </header>

      {/* 1. Overview */}
      <section>
        <div className="sec-head">
          <div className="num">1</div>
          <h2>Overview</h2>
          <div className="rule"></div>
          <div className="metaq">{rangeLabel}</div>
        </div>
        <div className="kpis">
          <div className="kpi">
            <div className="tag">Total Spend</div>
            <div className="val">{aed0(overview.spend)}</div>
            <Delta v={pct(overview.spend, prevOverview.spend)} />
          </div>
          <div className="kpi lead">
            <div className="tag">No. of Leads</div>
            <div className="val">{num(overview.leads)}</div>
            <Delta v={pct(overview.leads, prevOverview.leads)} />
          </div>
          <div className="kpi">
            <div className="tag">
              CPL <span style={{ opacity: 0.5 }}>· Cost / Lead</span>
            </div>
            <div className="val">
              {cplStr(overview)} <small>per lead</small>
            </div>
            <Delta v={pct(curCpl, prevCpl)} invert />
          </div>
        </div>
      </section>

      {/* 2. Event Level */}
      <section>
        <div className="sec-head">
          <div className="num">2</div>
          <h2>Event Level</h2>
          <div className="rule"></div>
          <div className="metaq">Event vs Non-Event</div>
        </div>
        <div className="grid-2">
          <DrillCard title="Event" sub="Lead-event & campaign activity" dotClass="dot" total={evAll} />
          <DrillCard title="Non-Event" sub="Always-on / evergreen" dotClass="dot alt" total={nevAll} />
        </div>
      </section>

      {/* 3. Platform Level */}
      <section>
        <div className="sec-head">
          <div className="num">3</div>
          <h2>Platform Level</h2>
          <div className="rule"></div>
          <div className="metaq">Tap a card to expand Event / Non-Event</div>
        </div>
        <div className="grid-2">
          <DrillCard
            title="Platform · Meta"
            sub="Facebook / Instagram"
            dotClass="dot"
            total={overview}
            event={evAll}
            nonevent={nevAll}
            drillable
          />
          <DrillCard title="Platform · Google" sub="not connected" dotClass="dot warm" total={z()} muted />
        </div>
      </section>

      {/* 4. Meta Account Level */}
      <section>
        <div className="sec-head">
          <div className="num">4</div>
          <h2>Meta Account Level</h2>
          <div className="rule"></div>
          <div className="metaq">Accounts roll up into Platform · Meta</div>
        </div>
        <div className="grid-2">
          {accounts.map((a, i) => (
            <DrillCard
              key={a.id}
              title={a.name}
              sub="Meta"
              dotClass={i === 0 ? "dot" : "dot mut"}
              total={a.total}
              event={a.event}
              nonevent={a.nonevent}
              drillable
            />
          ))}
          {accounts.length === 0 && (
            <div className="card">
              <div className="card-top">
                <span className="dot mut"></span>
                <h3>No spend in this range</h3>
              </div>
            </div>
          )}
        </div>
        <div className="legend">
          <span>
            <span className="pill ev">EVENT</span> campaign / lead-event activity
          </span>
          <span>
            <span className="pill nev">NON-EVENT</span> always-on / evergreen
          </span>
        </div>
      </section>

      <p className="note">CPL = Total Spend ÷ Meta-reported leads · figures scale with the selected date range</p>
    </div>
  );
}
