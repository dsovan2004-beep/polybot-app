// ============================================================================
// PolyBot — Supabase Client & Database Helpers
// Persistence layer for trades, signals, performance, and whale data
// ============================================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  Trade,
  Signal,
  Performance,
  Rebate,
  WhaleActivity,
  WhaleAlert,
  SwarmVote,
  SwarmResult,
  MakerOrder,
  BotConfig,
  TradingMode,
  StrategyName,
  BotStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Database type map (mirrors Supabase table names)
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      trades: { Row: Trade; Insert: Omit<Trade, "id" | "createdAt">; Update: Partial<Trade> };
      signals: { Row: Signal; Insert: Omit<Signal, "id" | "createdAt">; Update: Partial<Signal> };
      rebates: { Row: Rebate; Insert: Omit<Rebate, "id">; Update: Partial<Rebate> };
      whale_activity: { Row: WhaleActivity; Insert: Omit<WhaleActivity, "id">; Update: Partial<WhaleActivity> };
      whale_alerts: { Row: WhaleAlert; Insert: Omit<WhaleAlert, "id" | "createdAt">; Update: Partial<WhaleAlert> };
      swarm_votes: { Row: SwarmVote; Insert: Omit<SwarmVote, "id">; Update: Partial<SwarmVote> };
      swarm_results: { Row: SwarmResult; Insert: Omit<SwarmResult, "id" | "createdAt">; Update: Partial<SwarmResult> };
      maker_orders: { Row: MakerOrder; Insert: Omit<MakerOrder, "id">; Update: Partial<MakerOrder> };
      bot_state: { Row: BotStateRow; Insert: Omit<BotStateRow, "id">; Update: Partial<BotStateRow> };
    };
  };
}

interface BotStateRow {
  id: string;
  status: BotStatus;
  mode: TradingMode;
  activeStrategies: StrategyName[];
  config: BotConfig;
  startedAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Trade CRUD
// ---------------------------------------------------------------------------

export async function insertTrade(trade: Omit<Trade, "id" | "createdAt">) {
  const { data, error } = await getSupabase()
    .from("trades")
    .insert(trade)
    .select()
    .single();
  if (error) throw new Error(`insertTrade: ${error.message}`);
  return data as Trade;
}

export async function updateTrade(id: string, patch: Partial<Trade>) {
  const { data, error } = await getSupabase()
    .from("trades")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`updateTrade: ${error.message}`);
  return data as Trade;
}

export async function getRecentTrades(limit = 50, mode?: TradingMode) {
  let query = getSupabase()
    .from("trades")
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (mode) query = query.eq("mode", mode);
  const { data, error } = await query;
  if (error) throw new Error(`getRecentTrades: ${error.message}`);
  return data as Trade[];
}

export async function getTradesByStrategy(strategy: StrategyName, limit = 100) {
  const { data, error } = await getSupabase()
    .from("trades")
    .select("*")
    .eq("strategyName", strategy)
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getTradesByStrategy: ${error.message}`);
  return data as Trade[];
}

// ---------------------------------------------------------------------------
// Signal CRUD
// ---------------------------------------------------------------------------

export async function insertSignal(signal: Omit<Signal, "id" | "createdAt">) {
  const { data, error } = await getSupabase()
    .from("signals")
    .insert(signal)
    .select()
    .single();
  if (error) throw new Error(`insertSignal: ${error.message}`);
  return data as Signal;
}

export async function getRecentSignals(limit = 30) {
  const { data, error } = await getSupabase()
    .from("signals")
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentSignals: ${error.message}`);
  return data as Signal[];
}

// ---------------------------------------------------------------------------
// Rebate CRUD
// ---------------------------------------------------------------------------

export async function insertRebate(rebate: Omit<Rebate, "id">) {
  const { data, error } = await getSupabase()
    .from("rebates")
    .insert(rebate)
    .select()
    .single();
  if (error) throw new Error(`insertRebate: ${error.message}`);
  return data as Rebate;
}

export async function getTotalRebates(): Promise<number> {
  const { data, error } = await getSupabase()
    .from("rebates")
    .select("amount");
  if (error) throw new Error(`getTotalRebates: ${error.message}`);
  return (data as { amount: number }[]).reduce((sum, r) => sum + r.amount, 0);
}

// ---------------------------------------------------------------------------
// Whale Activity & Alerts
// ---------------------------------------------------------------------------

export async function insertWhaleActivity(
  activity: Omit<WhaleActivity, "id">
) {
  const { data, error } = await getSupabase()
    .from("whale_activity")
    .insert(activity)
    .select()
    .single();
  if (error) throw new Error(`insertWhaleActivity: ${error.message}`);
  return data as WhaleActivity;
}

export async function insertWhaleAlert(alert: Omit<WhaleAlert, "id" | "createdAt">) {
  const { data, error } = await getSupabase()
    .from("whale_alerts")
    .insert(alert)
    .select()
    .single();
  if (error) throw new Error(`insertWhaleAlert: ${error.message}`);
  return data as WhaleAlert;
}

export async function getRecentWhaleAlerts(limit = 20) {
  const { data, error } = await getSupabase()
    .from("whale_alerts")
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentWhaleAlerts: ${error.message}`);
  return data as WhaleAlert[];
}

// ---------------------------------------------------------------------------
// Swarm (AI consensus)
// ---------------------------------------------------------------------------

export async function insertSwarmVote(vote: Omit<SwarmVote, "id">) {
  const { data, error } = await getSupabase()
    .from("swarm_votes")
    .insert(vote)
    .select()
    .single();
  if (error) throw new Error(`insertSwarmVote: ${error.message}`);
  return data as SwarmVote;
}

export async function insertSwarmResult(result: Omit<SwarmResult, "id" | "createdAt">) {
  const { data, error } = await getSupabase()
    .from("swarm_results")
    .insert(result)
    .select()
    .single();
  if (error) throw new Error(`insertSwarmResult: ${error.message}`);
  return data as SwarmResult;
}

export async function getLatestSwarmResult(marketId: string) {
  const { data, error } = await getSupabase()
    .from("swarm_results")
    .select("*")
    .eq("marketId", marketId)
    .order("createdAt", { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== "PGRST116") {
    throw new Error(`getLatestSwarmResult: ${error.message}`);
  }
  return (data as SwarmResult) ?? null;
}

// ---------------------------------------------------------------------------
// Maker Orders
// ---------------------------------------------------------------------------

export async function insertMakerOrder(order: Omit<MakerOrder, "id">) {
  const { data, error } = await getSupabase()
    .from("maker_orders")
    .insert(order)
    .select()
    .single();
  if (error) throw new Error(`insertMakerOrder: ${error.message}`);
  return data as MakerOrder;
}

export async function getOpenMakerOrders(marketId?: string) {
  let query = getSupabase()
    .from("maker_orders")
    .select("*")
    .in("status", ["pending", "open"])
    .order("placedAt", { ascending: false });
  if (marketId) query = query.eq("marketId", marketId);
  const { data, error } = await query;
  if (error) throw new Error(`getOpenMakerOrders: ${error.message}`);
  return data as MakerOrder[];
}

export async function updateMakerOrder(id: string, patch: Partial<MakerOrder>) {
  const { data, error } = await getSupabase()
    .from("maker_orders")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`updateMakerOrder: ${error.message}`);
  return data as MakerOrder;
}

// ---------------------------------------------------------------------------
// Bot State
// ---------------------------------------------------------------------------

export async function getBotState() {
  const { data, error } = await getSupabase()
    .from("bot_state")
    .select("*")
    .order("updatedAt", { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== "PGRST116") {
    throw new Error(`getBotState: ${error.message}`);
  }
  return (data as BotStateRow) ?? null;
}

export async function upsertBotState(state: Omit<BotStateRow, "id">) {
  const { data, error } = await getSupabase()
    .from("bot_state")
    .upsert(state, { onConflict: "id" })
    .select()
    .single();
  if (error) throw new Error(`upsertBotState: ${error.message}`);
  return data as BotStateRow;
}

// ---------------------------------------------------------------------------
// Performance — computed from trades
// ---------------------------------------------------------------------------

export async function computePerformance(
  mode: TradingMode = "paper",
  windowHours = 24
): Promise<Performance> {
  const since = new Date(
    Date.now() - windowHours * 60 * 60 * 1000
  ).toISOString();

  const { data: trades, error } = await getSupabase()
    .from("trades")
    .select("*")
    .eq("mode", mode)
    .gte("createdAt", since)
    .order("createdAt", { ascending: false });

  if (error) throw new Error(`computePerformance: ${error.message}`);
  const all = (trades ?? []) as Trade[];

  const closed = all.filter((t) => t.pnl !== null);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const unrealized = all
    .filter((t) => t.status === "filled" && t.pnl === null)
    .reduce((s, t) => s + (t.avgFillPrice ?? 0) * t.filledSize, 0);

  const totalRebates = await getTotalRebates();

  const now = new Date().toISOString();

  return {
    totalPnl: totalPnl + unrealized,
    realizedPnl: totalPnl,
    unrealizedPnl: unrealized,
    totalTrades: all.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    avgConfidence:
      all.length > 0
        ? all.reduce((s, t) => s + t.aiConfidence, 0) / all.length
        : 0,
    totalVolume: all.reduce((s, t) => s + t.size * t.price, 0),
    totalRebates,
    sharpeRatio: null, // needs more data for proper Sharpe
    maxDrawdownPercent: 0, // calculated separately in risk engine
    drawdownPercent24h: 0,
    equity: 0, // set by caller with wallet balance
    exposure: all
      .filter((t) => t.status === "filled" || t.status === "partially_filled")
      .reduce((s, t) => s + t.filledSize * (t.avgFillPrice ?? 0), 0),
    openPositionCount: all.filter(
      (t) => t.status === "filled" && t.closedAt === null
    ).length,
    killSwitchTriggered: false,
    periodStart: since,
    periodEnd: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Realtime subscriptions (Supabase Realtime)
// ---------------------------------------------------------------------------

export function subscribeToTrades(
  callback: (trade: Trade) => void
): () => void {
  const channel = getSupabase()
    .channel("trades-realtime")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "trades" },
      (payload) => callback(payload.new as Trade)
    )
    .subscribe();

  return () => {
    getSupabase().removeChannel(channel);
  };
}

export function subscribeToWhaleAlerts(
  callback: (alert: WhaleAlert) => void
): () => void {
  const channel = getSupabase()
    .channel("whale-alerts-realtime")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "whale_alerts" },
      (payload) => callback(payload.new as WhaleAlert)
    )
    .subscribe();

  return () => {
    getSupabase().removeChannel(channel);
  };
}
