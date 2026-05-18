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
