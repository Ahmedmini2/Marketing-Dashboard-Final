import { todayISO } from "./utils";
import type { DateRange } from "./types";

export type SearchParams = { [k: string]: string | string[] | undefined };

export type SortKey =
  | "newest"
  | "oldest"
  | "spend_desc"
  | "spend_asc"
  | "leads_desc"
  | "revenue_desc"
  | "profit_desc";

const SORT_KEYS: SortKey[] = [
  "newest", "oldest", "spend_desc", "spend_asc",
  "leads_desc", "revenue_desc", "profit_desc",
];

export function parseFilters(sp: SearchParams) {
  // Default to a wide all-time window (3 years back). User narrows via the date pickers.
  const from = (sp.from as string) || todayISO(-1095);
  const to = (sp.to as string) || todayISO(0);
  const sortRaw = (sp.sort as string) || "newest";
  const sort: SortKey = SORT_KEYS.includes(sortRaw as SortKey) ? (sortRaw as SortKey) : "newest";
  const minSpend = Number((sp.min_spend as string) ?? 0) || 0;
  // Hide zero-spend forms by default — user can set hide_no_spend=0 to show them.
  const hideNoSpend = (sp.hide_no_spend as string) !== "0";
  return {
    range: { from, to } as DateRange,
    campaignId: (sp.campaign as string) || undefined,
    agentId: (sp.agent as string) || undefined,
    teamId: (sp.team as string) || undefined,
    sort,
    minSpend,
    hideNoSpend,
  };
}
