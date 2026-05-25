import { supabaseAdmin } from "@/lib/supabase/admin";
import { sfConnection } from "./client";
import type { Connection } from "jsforce";

type SyncStats = { agents: number; teams: number; leads: number; bookings: number };

const CAMPAIGN_FIELD      = process.env.SF_LEAD_CAMPAIGN_FIELD           || "Campaign_Name__c";
const BOOKING_OBJECT      = process.env.SF_BOOKING_OBJECT                 || "Booking__c";
const BOOKING_AMOUNT      = process.env.SF_BOOKING_AMOUNT_FIELD           || "Booking_Price__c";
const BOOKING_LEAD_LOOKUP = process.env.SF_BOOKING_LEAD_LOOKUP_FIELD      || "Lead__c";
const GROSS_COMMISSION    = process.env.SF_BOOKING_GROSS_COMMISSION_FIELD  || "Gross_Commission__c";
const NET_COMMISSION      = process.env.SF_BOOKING_NET_COMMISSION_FIELD    || "Net_Commission__c";

// Which LeadSource values count as "Facebook". Comma-separated, default = Facebook only.
const LEAD_SOURCES = (process.env.SF_LEAD_SOURCE_FILTER || "Facebook")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const sourceListSoql = LEAD_SOURCES.map((s) => `'${s.replace(/'/g, "\\'")}'`).join(",");

// How many leads to keep in Supabase. Set to 0 / unset for "all".
const LEAD_LIMIT = Number(process.env.SF_LEAD_MAX || 0) || 0;

/**
 * Run a SOQL query and paginate through all batches (jsforce returns ~2k per
 * batch by default, with the rest behind nextRecordsUrl).
 */
async function queryAll<T = any>(conn: Connection, soql: string): Promise<T[]> {
  const out: T[] = [];
  let result: any = await conn.query(soql);
  out.push(...(result.records as T[]));
  while (result.done === false && result.nextRecordsUrl) {
    result = await conn.queryMore(result.nextRecordsUrl);
    out.push(...(result.records as T[]));
  }
  return out;
}

/**
 * PostgREST `.in()` truncates long URL lists, so chunk a long id list into
 * several queries and merge results.
 */
async function chunkedExistingIds(
  db: ReturnType<typeof supabaseAdmin>,
  table: string,
  ids: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await db.from(table).select("id").in("id", slice);
    if (error) throw error;
    for (const r of data ?? []) out.add((r as any).id);
  }
  return out;
}

/**
 * Sync Salesforce into Supabase.
 *
 * - Teams = distinct managers (User.Manager).
 * - Leads filtered by LeadSource (default Facebook only). Pull ALL of them via
 *   pagination — orgs commonly have hundreds of thousands.
 * - Bookings: paginated. Each booking's Lead__c lookup is matched against
 *   sf_leads; non-FB lookups get nulled out (FK guard).
 */
export async function syncSalesforce(): Promise<SyncStats> {
  const conn = await sfConnection();
  const db = supabaseAdmin();
  const stats: SyncStats = { agents: 0, teams: 0, leads: 0, bookings: 0 };

  // --- Users (agents) + Managers (teams) ----------------------------------
  const users = await queryAll<any>(
    conn,
    "SELECT Id, Name, Email, ManagerId, Manager.Name FROM User WHERE IsActive = true"
  );

  const teamMap = new Map<string, string>();
  for (const u of users) {
    if (u.ManagerId && u.Manager?.Name) teamMap.set(u.ManagerId, u.Manager.Name);
  }
  if (teamMap.size) {
    await db.from("sf_teams").upsert(
      [...teamMap.entries()].map(([id, name]) => ({ id, name }))
    );
    stats.teams = teamMap.size;
  }

  if (users.length) {
    // Chunk upserts so we don't hit body size limits.
    const CHUNK = 500;
    for (let i = 0; i < users.length; i += CHUNK) {
      const slice = users.slice(i, i + CHUNK);
      const { error } = await db.from("sf_agents").upsert(
        slice.map((u) => ({
          id: u.Id,
          name: u.Name,
          email: u.Email,
          team_id: u.ManagerId ?? null,
        }))
      );
      if (error) throw new Error(`agents upsert: ${error.message}`);
    }
    stats.agents = users.length;
  }

  // --- Leads — Facebook only, paginated ------------------------------------
  const limitClause = LEAD_LIMIT > 0 ? `LIMIT ${LEAD_LIMIT}` : "";
  const leadSoql = `
    SELECT Id, ${CAMPAIGN_FIELD}, LeadSource, OwnerId, Status, Sales_Journey__c, CreatedDate
    FROM Lead
    WHERE LeadSource IN (${sourceListSoql})
    ORDER BY CreatedDate DESC
    ${limitClause}
  `;
  const leads = await queryAll<any>(conn, leadSoql);
  if (leads.length) {
    // Some leads will reference inactive owners not in sf_agents — null those out.
    const distinctOwners = [...new Set(leads.map((l) => l.OwnerId).filter((x): x is string => !!x))];
    const knownLeadOwners = await chunkedExistingIds(db, "sf_agents", distinctOwners);

    const CHUNK = 500;
    for (let i = 0; i < leads.length; i += CHUNK) {
      const slice = leads.slice(i, i + CHUNK);
      const { error } = await db.from("sf_leads").upsert(
        slice.map((l) => ({
          id: l.Id,
          campaign_name: l[CAMPAIGN_FIELD] ?? null,
          lead_source: l.LeadSource ?? null,
          agent_id: l.OwnerId && knownLeadOwners.has(l.OwnerId) ? l.OwnerId : null,
          status: l.Status,
          sales_journey: l.Sales_Journey__c ?? null,
          created_date: l.CreatedDate,
        }))
      );
      if (error) throw new Error(`leads upsert: ${error.message}`);
    }
    stats.leads = leads.length;
  }

  // --- Bookings, paginated -------------------------------------------------
  const bookingSoql = `
    SELECT Id, ${BOOKING_LEAD_LOOKUP}, OwnerId, ${BOOKING_AMOUNT}, ${GROSS_COMMISSION}, ${NET_COMMISSION}, CreatedDate
    FROM ${BOOKING_OBJECT}
  `;
  type BookingRow = { Id: string; OwnerId: string; CreatedDate: string; [k: string]: any };

  let bookings: BookingRow[] = [];
  try {
    bookings = await queryAll<BookingRow>(conn, bookingSoql);
  } catch {
    const opps = await queryAll<any>(conn, `SELECT Id, OwnerId, Amount, CloseDate FROM Opportunity WHERE IsWon = true`);
    bookings = opps.map((r: any) => ({
      Id: r.Id,
      [BOOKING_LEAD_LOOKUP]: null,
      OwnerId: r.OwnerId,
      [BOOKING_AMOUNT]: r.Amount,
      CreatedDate: r.CloseDate,
    }));
  }

  if (bookings.length) {
    const leadIds = [...new Set(bookings.map((b: any) => b[BOOKING_LEAD_LOOKUP]).filter((x: any): x is string => !!x))];
    const agentIds = [...new Set(bookings.map((b: any) => b.OwnerId).filter((x: any): x is string => !!x))];

    const [knownLeads, knownAgents] = await Promise.all([
      chunkedExistingIds(db, "sf_leads", leadIds),
      chunkedExistingIds(db, "sf_agents", agentIds),
    ]);

    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < bookings.length; i += CHUNK) {
      const slice = bookings.slice(i, i + CHUNK);
      const { error, count } = await db.from("sf_bookings").upsert(
        slice.map((b: any) => {
          const lookup = b[BOOKING_LEAD_LOOKUP];
          return {
            id: b.Id,
            lead_id: lookup && knownLeads.has(lookup) ? lookup : null,
            agent_id: b.OwnerId && knownAgents.has(b.OwnerId) ? b.OwnerId : null,
            sale_amount:       Number(b[BOOKING_AMOUNT]    ?? 0),
            gross_commission:  Number(b[GROSS_COMMISSION]  ?? 0),
            net_commission:    Number(b[NET_COMMISSION]     ?? 0),
            booked_at: b.CreatedDate,
            status: "Booked",
          };
        }),
        { count: "exact" }
      );
      if (error) throw new Error(`bookings upsert: ${error.message}`);
      upserted += count ?? slice.length;
    }
    stats.bookings = upserted;
  }

  // Rebuild the precomputed maps that the dashboard reads from.
  // 1) campaign_name -> form_id mapping (fuzzy-resolved).
  // 2) lead_attribution table (materialised join — what the dashboard RPCs query).
  try {
    let r = await db.rpc("refresh_campaign_to_form");
    if (r.error) throw new Error(r.error.message);
    r = await db.rpc("refresh_lead_attribution");
    if (r.error) throw new Error(r.error.message);
  } catch (e: any) {
    console.warn("[sf] refresh helper failed (non-fatal):", e?.message);
  }

  await db
    .from("salesforce_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  return stats;
}
