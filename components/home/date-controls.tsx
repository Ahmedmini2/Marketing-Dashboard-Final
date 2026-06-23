"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

// from/to are day offsets from today (0 = today, -1 = yesterday, -6 = 6 days
// ago). "Today" spans 1 day; "7D" = the last 7 calendar days ending today.
const PRESETS: { label: string; from: number; to: number }[] = [
  { label: "Today",     from: 0,    to: 0  },
  { label: "Yesterday", from: -1,   to: -1 },
  { label: "7D",        from: -6,   to: 0  },
  { label: "30D",       from: -29,  to: 0  },
  { label: "90D",       from: -89,  to: 0  },
  { label: "6M",        from: -179, to: 0  },
];

// Build YYYY-MM-DD from LOCAL components (toISOString is UTC and would drift the
// day by one for users east/west of UTC near midnight).
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function offsetIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

function Inner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");

  // Defer "today" defaults to the client to avoid SSR/CSR hydration mismatches.
  useEffect(() => {
    const d = Number(params.get("days")) || 30;
    if (!params.get("from")) setFrom(offsetIso(-(d - 1)));
    if (!params.get("to")) setTo(offsetIso(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function push(f: string, t: string) {
    const sp = new URLSearchParams();
    sp.set("from", f);
    sp.set("to", t);
    router.push(`${pathname}?${sp.toString()}`);
  }
  function applyPreset(p: (typeof PRESETS)[number]) {
    const f = offsetIso(p.from);
    const t = offsetIso(p.to);
    setFrom(f);
    setTo(t);
    push(f, t);
  }
  function onDate(f: string, t: string) {
    if (f && t) push(f, t);
  }
  const isActive = (p: (typeof PRESETS)[number]) =>
    Boolean(from) && Boolean(to) && from === offsetIso(p.from) && to === offsetIso(p.to);

  return (
    <div className="controls">
      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className={isActive(p) ? "active" : ""}
            onClick={() => applyPreset(p)}
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
