"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn, fmtMoney, fmtNum, fmtPct } from "@/lib/utils";

/**
 * Declarative column config — no render fns so the table can be a Client
 * Component and server pages pass plain serialisable data through.
 *
 * `format` controls how the cell is rendered. `currencyKey` names a row field
 * whose value (e.g. "AED") is used as the currency code for money formats.
 */
export type Column<T> = {
  key: keyof T & string;
  header: string;
  align?: "left" | "right";
  format?:
    | "text"
    | "num"
    | "money"
    | "money_pl"   // colored green/red by sign
    | "pct"
    | "ratio_x";   // "1.23x"
  currencyKey?: keyof T & string;
  fallback?: string;
  sortable?: boolean;      // defaults to true
};

function cellValue<T extends Record<string, any>>(row: T, col: Column<T>): React.ReactNode {
  const raw = row[col.key];
  const currency = col.currencyKey ? (row[col.currencyKey] as string | null | undefined) ?? "AED" : "AED";
  if (raw === null || raw === undefined) return col.fallback ?? "—";
  switch (col.format) {
    case "num": return fmtNum(Number(raw));
    case "money": return fmtMoney(Number(raw), currency);
    case "money_pl": {
      const n = Number(raw);
      return <span className={n >= 0 ? "text-good" : "text-bad"}>{fmtMoney(n, currency)}</span>;
    }
    case "pct": return fmtPct(Number(raw));
    case "ratio_x": return Number.isFinite(Number(raw)) ? `${Number(raw).toFixed(2)}x` : "—";
    case "text":
    default:
      return String(raw);
  }
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  empty = "No data",
  pageSize = 25,
}: {
  rows: T[];
  columns: Column<T>[];
  empty?: string;
  pageSize?: number;
}) {
  // Sort state: null sortKey ⇒ default row order. Clicks cycle asc → desc → off.
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  function clickHeader(col: Column<T>) {
    if (col.sortable === false) return;
    setPage(0);
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const c = cmp(a[sortKey], b[sortKey]);
      return sortDir === "asc" ? c : -c;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => clickHeader(c)}
                    className={cn(
                      c.align === "right" && "text-right",
                      sortable && "cursor-pointer select-none hover:text-text",
                    )}
                  >
                    <span className={cn(
                      "inline-flex items-center gap-1",
                      c.align === "right" && "flex-row-reverse",
                    )}>
                      {c.header}
                      {sortable && active && (
                        sortDir === "asc"
                          ? <ArrowUp size={12} className="opacity-70" />
                          : <ArrowDown size={12} className="opacity-70" />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="text-muted text-center py-6">{empty}</td>
              </tr>
            )}
            {pageRows.map((row, i) => (
              <tr key={start + i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === "right" ? "text-right" : ""}>
                    {cellValue(row, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length > pageSize && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted">
          <div>
            {start + 1}–{Math.min(start + pageSize, sorted.length)} of {fmtNum(sorted.length)}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn px-2 py-1"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={14} />
            </button>
            <span>page {safePage + 1} / {totalPages}</span>
            <button
              className="btn px-2 py-1"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
