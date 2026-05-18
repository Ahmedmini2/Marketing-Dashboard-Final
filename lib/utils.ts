import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Base currency for the dashboard. Aggregate KPIs are always reported in AED.
// USD-account spend is converted using the fixed rate below before summing.
export const BASE_CURRENCY = "AED";
export const AED_PER_USD = 3.67;

/** Convert an amount in `from` currency to AED. AED returns unchanged. */
export function toAED(amount: number, from: string | null | undefined): number {
  if (!Number.isFinite(amount)) return 0;
  const cur = (from || "AED").toUpperCase();
  if (cur === "AED") return amount;
  if (cur === "USD") return amount * AED_PER_USD;
  return amount; // unknown currency — treat as base
}

export const fmtMoney = (n: number, currency = BASE_CURRENCY) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);

export const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-US").format(Math.round(Number.isFinite(n) ? n : 0));

export const fmtPct = (n: number, digits = 1) =>
  `${(Number.isFinite(n) ? n * 100 : 0).toFixed(digits)}%`;

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
