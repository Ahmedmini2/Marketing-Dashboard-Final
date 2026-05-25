export type DateRange = { from: string; to: string };

export type LeadAttribution = {
  lead_id: string;
  campaign_name: string | null;
  form_id: string | null;
  form_name: string | null;
  agent_id: string | null;
  team_id: string | null;
  lead_status: string | null;
  sales_journey: string | null;
  created_date: string | null;
  attributed_spend: number;
  currency: string | null;
  revenue: number;
  bookings_count: number;
};

export type KpiSummary = {
  spend: number;
  leads: number;
  bookings: number;
  revenue: number;
  profit: number;            // revenue - spend
  cpl: number;               // spend / leads
  roas: number;              // revenue / spend
  margin: number;            // profit / revenue
};

export type CampaignRow = {
  form_id: string | null;
  form_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  created_time: string | null;
  currency: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  bookings: number;
  revenue: number;
  profit: number;
  cpl: number;
  roas: number;
};

export type AgentRow = {
  agent_id: string | null;
  agent_name: string | null;
  team_id: string | null;
  team_name: string | null;
  leads: number;
  bookings: number;
  spend: number;
  revenue: number;
  profit: number;
  cpl: number;
  roas: number;
};

/**
 * One row in the Performance dashboard — used for both the monthly summary
 * (parent) and the individual-campaign breakdown (child).
 *
 * `label` holds the display value for the first column:
 *   parent row → "Jan 2025"
 *   child row  → campaign name
 */
export type PerformanceRow = {
  label: string;
  spend: number;
  leads: number;
  cpl: number;              // spend / leads
  unit_price: number;       // sum of Booking_Price__c (value of units sold)
  gross_commission: number; // sum of Gross_Commission__c
  net_commission: number;   // sum of Net_Commission__c  (Allegiance share)
  pnl: number;              // net_commission − spend
  roi: number;              // pnl / spend  (decimal: 0.5 = 50 %)
};
