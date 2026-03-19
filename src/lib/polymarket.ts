// ============================================================================
// PolyBot — Polymarket Live WebSocket Feed (Sprint 4)
// Connects to Polymarket public WS for real-time trades
// Filters, stores to Supabase markets + whale_activity tables
// ============================================================================

import { getSupabase } from "./supabase";
import type { MarketRow } from "./supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLYMARKET_WS_URL =
  "wss://ws-subscriptions-clob.polymarket.com/ws/market";

const MIN_USD_AMOUNT = 500;
const PRICE_MIN = 0.02;
const PRICE_MAX = 0.98;

const SPORTS_KEYWORDS = [
  "nba", "nfl", "ufc", "football", "basketball", "soccer",
  "mlb", "nhl", "tennis", "boxing", "mma", "premier league",
  "champions league", "world cup", "super bowl",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolymarketTrade {
  conditionId: string;
  title: string;
  outcome: string;
  price: number;
  size: number;
  usdAmount: number;
  timestamp: string;
}

export interface WhaleActivityRow {
  id: string;
  market_id: string;
  wallet_address: string;
  direction: string;
  trade_size_usd: number;
  price_at_trade: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _connected = false;
let _recentTrades: PolymarketTrade[] = [];

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function isSportsMarket(title: string): boolean {
  const lower = title.toLowerCase();
  return SPORTS_KEYWORDS.some((kw) => lower.includes(kw));
}

function passesFilters(trade: PolymarketTrade): boolean {
  if (trade.usdAmount < MIN_USD_AMOUNT) return false;
  if (trade.price < PRICE_MIN || trade.price > PRICE_MAX) return false;
  if (isSportsMarket(trade.title)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Supabase persistence
// ---------------------------------------------------------------------------

async function saveToMarkets(trade: PolymarketTrade): Promise<MarketRow | null> {
  try {
    const { data, error } = await getSupabase()
      .from("markets")
      .upsert(
        {
          polymarket_id: trade.conditionId,
          title: trade.title,
          category: categorize(trade.title),
          current_price: trade.price,
          volume_24h: trade.usdAmount,
          status: "active",
        },
        { onConflict: "polymarket_id" }
      )
      .select()
      .single();
    if (error) {
      console.error("[polymarket] saveToMarkets:", error.message);
      return null;
    }
    return data as MarketRow;
  } catch (err) {
    console.error("[polymarket] saveToMarkets exception:", err);
    return null;
  }
}

async function saveWhaleActivity(
  trade: PolymarketTrade,
  marketId: string
): Promise<void> {
  try {
    // whale_activity table columns: market_id, wallet_address, direction, trade_size_usd, price_at_trade
    await getSupabase().from("whale_activity").insert({
      market_id: marketId,
      wallet_address: "polymarket-ws",
      direction: trade.outcome.toLowerCase() === "yes" ? "yes" : "no",
      trade_size_usd: trade.usdAmount,
      price_at_trade: trade.price,
    });
  } catch {
    // Table doesn't exist yet — skip silently
  }
}

function categorize(title: string): string {
  const lower = title.toLowerCase();
  const aiKeywords = [
    "ai", "artificial intelligence", "openai", "chatgpt", "llm",
    "tech", "apple", "google", "microsoft", "nvidia", "meta",
    "crypto", "bitcoin", "ethereum", "btc", "eth",
  ];
  const politicsKeywords = [
    "trump", "biden", "election", "president", "congress",
    "senate", "governor", "vote", "democrat", "republican",
    "political", "policy", "supreme court",
  ];
  if (aiKeywords.some((kw) => lower.includes(kw))) return "ai_tech";
  if (politicsKeywords.some((kw) => lower.includes(kw))) return "politics";
  return "other";
}

// ---------------------------------------------------------------------------
// Parse incoming WS trade message
// ---------------------------------------------------------------------------

function parseTradeMessage(raw: string): PolymarketTrade | null {
  try {
    const msg = JSON.parse(raw);

    // Handle different message formats from Polymarket WS
    const conditionId = msg.asset_id ?? msg.condition_id ?? msg.market ?? "";
    const title = msg.question ?? msg.title ?? msg.market_slug ?? conditionId;
    const outcome = msg.outcome ?? msg.side ?? "unknown";
    const price = parseFloat(msg.price ?? msg.last_price ?? "0");
    const size = parseFloat(msg.size ?? msg.amount ?? "0");

    if (!conditionId || isNaN(price) || isNaN(size)) return null;

    return {
      conditionId,
      title,
      outcome,
      price,
      size,
      usdAmount: price * size,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Process a trade — filter, store, track
// ---------------------------------------------------------------------------

async function processTrade(trade: PolymarketTrade): Promise<void> {
  if (!passesFilters(trade)) return;

  // Keep in memory (last 100 trades)
  _recentTrades.unshift(trade);
  if (_recentTrades.length > 100) _recentTrades.length = 100;

  // Save to markets table
  const market = await saveToMarkets(trade);
  if (!market) return;

  // Save whale activity (all trades >= $500 pass filter)
  await saveWhaleActivity(trade, market.id);
}

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

export function connectPolymarketFeed(): () => void {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    return () => disconnectFeed();
  }

  try {
    _ws = new WebSocket(POLYMARKET_WS_URL);

    _ws.onopen = () => {
      console.log("[polymarket] Connected to Polymarket WS");
      _connected = true;

      // Subscribe to activity channel
      if (_ws?.readyState === WebSocket.OPEN) {
        _ws.send(
          JSON.stringify({
            type: "subscribe",
            channel: "activity",
            market: "orders_matched",
          })
        );
      }
    };

    _ws.onmessage = (event: MessageEvent) => {
      const trade = parseTradeMessage(
        typeof event.data === "string" ? event.data : ""
      );
      if (trade) {
        processTrade(trade).catch(console.error);
      }
    };

    _ws.onclose = (event: CloseEvent) => {
      console.log(`[polymarket] Disconnected (code: ${event.code})`);
      _connected = false;

      // Auto-reconnect after 5 seconds
      if (event.code !== 1000) {
        _reconnectTimer = setTimeout(() => {
          connectPolymarketFeed();
        }, 5_000);
      }
    };

    _ws.onerror = () => {
      console.error("[polymarket] WebSocket error");
      _connected = false;
    };
  } catch (err) {
    console.error("[polymarket] Failed to connect:", err);
    _connected = false;
  }

  return () => disconnectFeed();
}

function disconnectFeed(): void {
  if (_ws) {
    _ws.close(1000, "client disconnect");
    _ws = null;
  }
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _connected = false;
  _recentTrades = [];
}

// ---------------------------------------------------------------------------
// Public getters
// ---------------------------------------------------------------------------

export function isConnected(): boolean {
  return _connected;
}

/** Get recent markets from Supabase (last 10, ordered by update). */
export async function getRecentMarkets(limit = 10): Promise<MarketRow[]> {
  const { data, error } = await getSupabase()
    .from("markets")
    .select("*")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentMarkets: ${error.message}`);
  return data as MarketRow[];
}

/** Get recent whale activity from Supabase. Returns empty if table doesn't exist. */
export async function getWhaleActivity(
  limit = 10
): Promise<WhaleActivityRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("whale_activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return []; // Table may not exist yet
    return data as WhaleActivityRow[];
  } catch {
    return [];
  }
}

/** Seed initial data — fetch recent markets from Supabase. */
export async function seedInitialData(): Promise<void> {
  console.log("[polymarket] Seeding initial market data from Supabase...");
  // Historical data will be populated as WS trades come in.
  // Future: call Polymarket REST API for last 24h of trades.
}
