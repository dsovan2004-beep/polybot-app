// ============================================================================
// PolyBot — Supabase Client & Database Helpers (Sprint 2)
// Matches 001_initial_schema.sql exactly: markets, signals, trades, rebates, performance
// Column names use snake_case to match Postgres schema
// ============================================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Row types — match SQL schema exactly (snake_case)
// ---------------------------------------------------------------------------

export interface MarketRow {
  id: string;
  polymarket_id: string;
  title: string;
  category: string;
  current_price: number | null;
  volume_24h: number | null;
  liquidity: number | null;
  closes_at: string | null;
  status: string;
  resolved_value: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalRow {
  id: string;
  market_id: string | null;
  strategy: string;
  claude_vote: string | null;
  gpt4o_vote: string | null;
  gemini_vote: string | null;
  consensus: string | null;
  confidence: number | null;
  ai_probability: number | null;
  market_price: number | null;
  price_gap: number | null;
  reasoning: string | null;
  acted_on: boolean;
  created_at: string;
}

export interface TradeRow {
  id: string;
  signal_id: string | null;
  market_id: string | null;
  direction: string;
  entry_price: number | null;
  exit_price: number | null;
  shares: number | null;
  entry_cost: number | null;
  exit_value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  strategy: string | null;
  status: string;
  entry_at: string;
  exit_at: string | null;
  hold_hours: number | null;
  notes: string | null;
}

export interface RebateRow {
  id: string;
  date: string;
  usdc_earned: number | null;
  markets_count: number | null;
  volume: number | null;
  created_at: string;
}

export interface PerformanceRow {
  id: string;
  date: string;
  starting_balance: number | null;
  ending_balance: number | null;
  trades_count: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  pnl_day: number | null;
  pnl_cumulative: number | null;
  rebates_earned: number | null;
  drawdown_pct: number | null;
  kill_switch: boolean;
}

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
// Service-role client (bypasses RLS — use for writes in edge routes)
// ---------------------------------------------------------------------------

let _serviceClient: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (!_serviceClient) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      console.warn("[supabase] No SUPABASE_SERVICE_ROLE_KEY — falling back to anon key");
      return getSupabase();
    }
    _serviceClient = createClient(SUPABASE_URL, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _serviceClient;
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export async function getMarkets(category?: string, limit = 50) {
  let query = getSupabase()
    .from("markets")
    .select("*")
    .eq("status", "active")
    .order("volume_24h", { ascending: false })
    .limit(limit);
  if (category) query = query.eq("category", category);
  const { data, error } = await query;
  if (error) throw new Error(`getMarkets: ${error.message}`);
  return data as MarketRow[];
}

export async function getMarketById(id: string) {
  const { data, error } = await getSupabase()
    .from("markets")
    .select("*")
    .eq("id", id)
    .single();
  if (error && error.code !== "PGRST116") {
    throw new Error(`getMarketById: ${error.message}`);
  }
  return (data as MarketRow) ?? null;
}

export async function upsertMarket(
  market: Omit<MarketRow, "id" | "created_at" | "updated_at">
) {
  const { data, error } = await getSupabase()
    .from("markets")
    .upsert(market, { onConflict: "polymarket_id" })
    .select()
    .single();
  if (error) throw new Error(`upsertMarket: ${error.message}`);
  return data as MarketRow;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export async function insertSignal(
  signal: Omit<SignalRow, "id" | "created_at">
) {
  const { data, error } = await getSupabase()
    .from("signals")
    .insert(signal)
    .select()
    .single();
  if (error) throw new Error(`insertSignal: ${error.message}`);
  return data as SignalRow;
}

export async function getRecentSignals(limit = 30) {
  const { data, error } = await getSupabase()
    .from("signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentSignals: ${error.message}`);
  return data as SignalRow[];
}

export async function getSignalsByMarket(marketId: string, limit = 20) {
  const { data, error } = await getSupabase()
    .from("signals")
    .select("*")
    .eq("market_id", marketId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getSignalsByMarket: ${error.message}`);
  return data as SignalRow[];
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export async function insertTrade(
  trade: Omit<TradeRow, "id" | "entry_at">
) {
  const { data, error } = await getSupabase()
    .from("trades")
    .insert(trade)
    .select()
    .single();
  if (error) throw new Error(`insertTrade: ${error.message}`);
  return data as TradeRow;
}

export async function updateTrade(id: string, patch: Partial<TradeRow>) {
  const { data, error } = await getSupabase()
    .from("trades")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`updateTrade: ${error.message}`);
  return data as TradeRow;
}

export async function getRecentTrades(limit = 50) {
  const { data, error } = await getSupabase()
    .from("trades")
    .select("*")
    .order("entry_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentTrades: ${error.message}`);
  return data as TradeRow[];
}

export async function getOpenTrades() {
  const { data, error } = await getSupabase()
    .from("trades")
    .select("*")
    .eq("status", "open")
    .order("entry_at", { ascending: false });
  if (error) throw new Error(`getOpenTrades: ${error.message}`);
  return data as TradeRow[];
}

export async function getTradesByStrategy(strategy: string, limit = 100) {
  const { data, error } = await getSupabase()
    .from("trades")
    .select("*")
    .eq("strategy", strategy)
    .order("entry_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getTradesByStrategy: ${error.message}`);
  return data as TradeRow[];
}

// ---------------------------------------------------------------------------
// Rebates
// ---------------------------------------------------------------------------

export async function insertRebate(rebate: Omit<RebateRow, "id" | "created_at">) {
  const { data, error } = await getSupabase()
    .from("rebates")
    .insert(rebate)
    .select()
    .single();
  if (error) throw new Error(`insertRebate: ${error.message}`);
  return data as RebateRow;
}

export async function getRecentRebates(limit = 30) {
  const { data, error } = await getSupabase()
    .from("rebates")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentRebates: ${error.message}`);
  return data as RebateRow[];
}

export async function getTotalRebates(): Promise<number> {
  const { data, error } = await getSupabase()
    .from("rebates")
    .select("usdc_earned");
  if (error) throw new Error(`getTotalRebates: ${error.message}`);
  return (data as { usdc_earned: number | null }[]).reduce(
    (sum, r) => sum + (r.usdc_earned ?? 0),
    0
  );
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export async function upsertPerformance(
  perf: Omit<PerformanceRow, "id">
) {
  const { data, error } = await getSupabase()
    .from("performance")
    .upsert(perf, { onConflict: "date" })
    .select()
    .single();
  if (error) throw new Error(`upsertPerformance: ${error.message}`);
  return data as PerformanceRow;
}

export async function getLatestPerformance() {
  const { data, error } = await getSupabase()
    .from("performance")
    .select("*")
    .order("date", { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== "PGRST116") {
    throw new Error(`getLatestPerformance: ${error.message}`);
  }
  return (data as PerformanceRow) ?? null;
}

export async function getPerformanceHistory(days = 30) {
  const { data, error } = await getSupabase()
    .from("performance")
    .select("*")
    .order("date", { ascending: false })
    .limit(days);
  if (error) throw new Error(`getPerformanceHistory: ${error.message}`);
  return data as PerformanceRow[];
}

// ---------------------------------------------------------------------------
// Realtime subscriptions
// ---------------------------------------------------------------------------

export function subscribeToTrades(callback: (trade: TradeRow) => void): () => void {
  const channel = getSupabase()
    .channel("trades-realtime")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "trades" },
      (payload) => callback(payload.new as TradeRow)
    )
    .subscribe();

  return () => {
    getSupabase().removeChannel(channel);
  };
}

export function subscribeToSignals(callback: (signal: SignalRow) => void): () => void {
  const channel = getSupabase()
    .channel("signals-realtime")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "signals" },
      (payload) => callback(payload.new as SignalRow)
    )
    .subscribe();

  return () => {
    getSupabase().removeChannel(channel);
  };
}
