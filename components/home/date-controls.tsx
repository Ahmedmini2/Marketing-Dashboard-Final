"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const PRESETS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
];

// Build YYYY-MM-DD from LOCAL components (toISOString is UTC and would drift the
// day by one for users east/west of UTC near midnight).
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function Inner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [activeDays, setActiveDays] = useState<number | null>(Number(params.get("days")) || 30);

  // Defer "today" defaults to the client to avoid SSR/CSR hydration mismatches.
  // Honour ?days=N so a days-only URL keeps inputs + preset highlight consistent.
  useEffect(() => {
    const d = Number(params.get("days")) || 30;
    if (!params.get("from")) setFrom(iso(daysAgo(d - 1)));
    if (!params.get("to")) setTo(iso(new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function push(f: string, t: string, days: number | null) {
    const sp = new URLSearchParams();
    sp.set("from", f);
    sp.set("to", t);
    if (days) sp.set("days", String(days));
    router.push(`${pathname}?${sp.toString()}`);
  }
  function preset(days: number) {
    const f = iso(daysAgo(days - 1));
    const t = iso(new Date());
    setFrom(f);
    setTo(t);
    setActiveDays(days);
    push(f, t, days);
  }
  function onDate(f: string, t: string) {
    setActiveDays(null);
    if (f && t) push(f, t, null);
  }

  return (
    <div className="controls">
      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            className={activeDays === p.days ? "active" : ""}
            onClick={() => preset(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="daterange">
        <div className="field">
          <label>From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              onDate(e.target.value, to);
            }}
          />
        </div>
        <div className="arrow">→</div>
        <div className="field">
          <label>To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              onDate(from, e.target.value);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function HomeDateControls() {
  return (
    <Suspense fallback={<div className="controls" />}>
      <Inner />
    </Suspense>
  );
}
