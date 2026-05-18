"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { cn, fmtMoney, fmtNum, fmtPct } from "@/lib/utils";
import type { Column } from "@/components/data-table";

export type Group<T> = { key: string; parent: T; children: T[] };

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

/**
 * Table that renders each Group as a parent row with an expand toggle.
 * Children render as indented rows under the parent when expanded.
 * Sort + pagination operate on the parent rows.
 */
export function GroupedDataTable<T extends Record<string, any>>({
  groups,
  columns,
  empty = "No data",
  pageSize = 25,
  parentLabelHeader = "Campaign",
}: {
  groups: Group<T>[];
  columns: Column<T>[];
  empty?: string;
  pageSize?: number;
  parentLabelHeader?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    if (!sortKey) return groups;
    return [...groups].sort((a, b) => {
      const c = cmp(a.parent[sortKey], b.parent[sortKey]);
      return sortDir === "asc" ? c : -c;
    });
  }, [groups, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const pageGroups = sorted.slice(start, start + pageSize);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function expandAll() { setExpanded(new Set(pageGroups.map((g) => g.key))); }
  function collapseAll() { setExpanded(new Set()); }

  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-8">
                <button
                  type="button"
                  onClick={expanded.size === 0 ? expandAll : collapseAll}
                  title={expanded.size === 0 ? "Expand all on page" : "Collapse all"}
                  className="text-muted hover:text-text"
                >
                  {expanded.size === 0 ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
              </th>
              {columns.map((c, i) => {
                const sortable = c.sortable !== false;
                const active = sortKey === c.key;
                const header = i === 0 ? parentLabelHeader : c.header;
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
                      {header}
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
            {pageGroups.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="text-muted text-center py-6">{empty}</td>
              </tr>
            )}
            {pageGroups.map((group) => {
              const isOpen = expanded.has(group.key);
              return (
                <Fragment key={group.key}>
                  <tr className="font-medium">
                    <td className="text-center">
                      <button
                        type="button"
                        className="text-muted hover:text-text"
                        onClick={() => toggle(group.key)}
                        title={isOpen ? "Collapse" : "Expand"}
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={c.align === "right" ? "text-right" : ""}>
                        {cellValue(group.parent, c)}
                        {/* Show child count next to first column on the parent row */}
                        {c === columns[0] && (
                          <span className="text-muted text-xs ml-2">
                            ({group.children.length} form{group.children.length === 1 ? "" : "s"})
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                  {isOpen && group.children.map((child, i) => (
                    <tr key={`${group.key}:child:${i}`} className="bg-white/[0.02]">
                      <td></td>
                      {columns.map((c, ci) => (
                        <td key={c.key} className={c.align === "right" ? "text-right" : ""}>
                          {ci === 0 ? (
                            <span className="pl-4 text-muted">↳ {cellValue(child, c)}</span>
                          ) : (
                            cellValue(child, c)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length > pageSize && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted">
          <div>
            {start + 1}–{Math.min(start + pageSize, sorted.length)} of {fmtNum(sorted.length)} campaigns
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
