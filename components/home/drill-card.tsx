"use client";
import { useState } from "react";

export type Agg = { spend: number; leads: number };

const aed0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(n || 0);
const aed2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "AED", maximumFractionDigits: 2 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));
const cpl = (d: Agg) => (d.leads > 0 ? aed2(d.spend / d.leads) : "—");

function Metrics({ d, sub = false }: { d: Agg; sub?: boolean }) {
  return (
    <>
      <div className="metric">
        <div className="m-tag">{sub ? "Spend" : "Total Spend"}</div>
        <div className="m-val">{aed0(d.spend)}</div>
      </div>
      <div className="metric">
        <div className="m-tag">{sub ? "Leads" : "No. of Leads"}</div>
        <div className="m-val">{num(d.leads)}</div>
      </div>
      <div className="metric">
        <div className="m-tag">CPL</div>
        <div className="m-val">{cpl(d)}</div>
      </div>
    </>
  );
}

export function DrillCard({
  title,
  sub,
  dotClass = "dot",
  total,
  event,
  nonevent,
  drillable = false,
  muted = false,
}: {
  title: string;
  sub: string;
  dotClass?: string;
  total: Agg;
  event?: Agg;
  nonevent?: Agg;
  drillable?: boolean;
  muted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`card${open ? " open" : ""}${muted ? " muted" : ""}`}>
      <div className="card-top">
        <span className={dotClass}></span>
        <h3>{title}</h3>
        <span className="sub">{sub}</span>
      </div>
      <div className="metrics">
        <Metrics d={total} />
      </div>
      {drillable && event && nonevent && (
        <>
          <button className="drill-toggle" onClick={() => setOpen((o) => !o)}>
            Event / Non-Event breakdown <span className="chev">▾</span>
          </button>
          <div className="drill">
            <div className="drill-inner">
              <div className="sub-row">
                <div className="sub-label">
                  <span className="pill ev">EVENT</span>
                </div>
                <div className="sub-metrics">
                  <Metrics d={event} sub />
                </div>
              </div>
              <div className="sub-row">
                <div className="sub-label">
                  <span className="pill nev">NON-EVENT</span>
                </div>
                <div className="sub-metrics">
                  <Metrics d={nonevent} sub />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
