#!/usr/bin/env npx ts-node
// ============================================================================
// PolyBot — Kalshi Feed Script (Sprint 7)
// Runs on your Mac, polls Kalshi REST API, analyzes with Claude, saves to Supabase
// Usage: npx ts-node src/scripts/feed.ts
// Requires: .env.local with Supabase + Anthropic + Kalshi keys
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";

// Telegram startup guard — fire only once
let kalshiAlertSent = false;

// Telegram alert helper (inline — avoids edge-only import)
async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Load .env.local from project root
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in .env.local");
  process.exit(1);
}

const useServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
if (useServiceRole) {
  console.log("✅ Using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)");
} else {
  console.warn("⚠️  Using anon key — RLS may block signal writes");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY not found — Claude analysis disabled");
} else {
  console.log(`✅ ANTHROPIC_API_KEY loaded (${ANTHROPIC_API_KEY.slice(0, 12)}...)`);
}
const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 15_000 })
  : null;

// Kalshi config
const KALSHI_HOST = "https://api.elections.kalshi.com";
const KALSHI_API_PREFIX = "/trade-api/v2";
const KALSHI_API_KEY = process.env.KALSHI_API_KEY;
// dotenv reads \n inside double-quoted values as literal two-char sequences;
// replace them with real newlines so crypto can parse the PEM key
const rawKalshiKey = process.env.KALSHI_PRIVATE_KEY || "";
const KALSHI_PRIVATE_KEY = rawKalshiKey.replace(/\\n/g, "\n");

if (!KALSHI_API_KEY || !KALSHI_PRIVATE_KEY) {
  console.error("Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY in .env.local");
  process.exit(1);
}
console.log(`✅ KALSHI_API_KEY loaded (${KALSHI_API_KEY.slice(0, 8)}...)`);
console.log(`✅ KALSHI_PRIVATE_KEY loaded (${KALSHI_PRIVATE_KEY.length} chars)`);

const PRICE_MIN = 0.02;
const PRICE_MAX = 0.98;
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const PAPER_MODE = false; // Set true to log trades without placing real orders
const MIN_BALANCE_FLOOR = 5.00; // Never trade below this balance ($)

// Dynamic position sizing — scales with bankroll + confidence
const POSITION_SIZE_PCT = 0.02;       // 2% of balance per trade (base)
const MIN_TRADE_DOLLARS = 0.50;       // Floor: never less than $0.50
const MAX_TRADE_DOLLARS_CAP = 5.00;   // Ceiling: never more than $5.00 per trade
const MAX_POSITIONS_PCT = 0.25;       // Deploy up to 25% of balance across all positions
const MAX_POSITIONS_FLOOR = 8;        // Minimum positions allowed
const MAX_POSITIONS_CEIL = 20;        // Maximum positions allowed

// Legacy constant kept for backward-compat references
const MAX_TRADE_DOLLARS = 1.25;       // Used as fallback only
const TAKE_PROFIT_PCT = 25;    // Sell when position is up 25%+
const STOP_LOSS_PCT = -40;     // Sell when position is down 40%+
const DAILY_PROFIT_TARGET = 3.00; // Stop trading after +$3 daily P&L
const DAILY_LOSS_LIMIT = -5.00;   // Stop trading after -$5 daily P&L

// ---------------------------------------------------------------------------
// Dynamic position sizing — scales with bankroll + Claude confidence
// ---------------------------------------------------------------------------
function calculateTradeSize(balance: number, confidence: number): number {
  const base = balance * POSITION_SIZE_PCT;
  let multiplier = 0.55; // default for 67% confidence
  if (confidence >= 90) multiplier = 1.0;
  else if (confidence >= 80) multiplier = 0.85;
  else if (confidence >= 70) multiplier = 0.70;
  // else 67-69 stays at 0.55
  let tradeSize = base * multiplier;
  tradeSize = Math.max(MIN_TRADE_DOLLARS, tradeSize);
  tradeSize = Math.min(MAX_TRADE_DOLLARS_CAP, tradeSize);
  return Math.round(tradeSize * 100) / 100;
}

function calculateMaxPositions(balance: number, tradeSize: number): number {
  const totalDeployable = balance * MAX_POSITIONS_PCT;
  let maxPos = Math.floor(totalDeployable / tradeSize);
  maxPos = Math.max(MAX_POSITIONS_FLOOR, maxPos);
  maxPos = Math.min(MAX_POSITIONS_CEIL, maxPos);
  return maxPos;
}

const SPORTS_KEYWORDS = [
  "nba", "nfl", "ufc", "football", "basketball", "soccer",
  "mlb", "nhl", "tennis", "boxing", "mma", "premier league",
  "champions league", "world cup", "super bowl", "playoff",
  "grand slam", "olympics",
  "fc", "vs.", "o/u", "open", "uefa", "premier",
  "laliga", "bundesliga", "serie a", "ligue 1", "mls",
  "vallecano", "porto", "stuttgart", "samsunspor",
  "forest", "madrid", "tagger", "seidel",
  "spread:", "commodores", "bulldogs",
  "ncaa", "spread", "covers", "ats",
  "masters", "world series", "astros",
  "yankees", "dodgers", "tournament",
  "pga", "golf", "baseball",
  "stanley cup", "championship",
  "t20", "cricket", "test match",
  "innings", "wicket", "odi", "ipl",
  "rugby", "ashes", "bowled", "batting",
  "twenty20", "nrl", "afl", "formula",
  "nascar", "racing", "grand prix",
  "cycling", "tour de france",
  "wrestling", "wwe", "ufc fight",
  "esports", "esport", "counter-strike", "cs2",
  "dota", "valorant", "overwatch", "league of legends",
  "lol", "game winner", "map 2", "map 3",
];

// ---------------------------------------------------------------------------
// Kalshi RSA-PSS Signing (Node.js native crypto)
// ---------------------------------------------------------------------------

function signRequest(
  privateKeyPem: string,
  timestampMs: string,
  method: string,
  fullPath: string
): string {
  const pathOnly = fullPath.split("?")[0];
  const message = `${timestampMs}${method}${pathOnly}`;
  // Key is already normalized at load time (literal \n → real newlines)
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(message);
  sign.end();
  return sign.sign(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
    "base64"
  );
}

async function kalshiFetch<T>(
  method: string,
  apiPath: string,
  body?: unknown
): Promise<T> {
  const fullPath = `${KALSHI_API_PREFIX}${apiPath}`;
  const timestampMs = String(Date.now());
  const signature = signRequest(KALSHI_PRIVATE_KEY!, timestampMs, method, fullPath);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": KALSHI_API_KEY!,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestampMs,
  };

  const url = `${KALSHI_HOST}${fullPath}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Kalshi ${method} ${fullPath} → ${res.status}: ${errText.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Kalshi types
// ---------------------------------------------------------------------------

interface KalshiMarketFromAPI {
  ticker: string;
  title: string;
  status: string;
  // Kalshi events endpoint returns dollar-denominated fields
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  yes_bid_dollars?: number;
  yes_ask_dollars?: number;
  no_bid_dollars?: number;
  no_ask_dollars?: number;
  last_price_dollars?: number;
  previous_price_dollars?: number;
  volume: number;
  volume_24h?: number;
  volume_24h_fp?: number;
  event_ticker?: string;
  [key: string]: unknown; // allow extra fields from API
}

interface KalshiEvent {
  event_ticker: string;
  title: string;
  markets?: KalshiMarketFromAPI[];
}

// ---------------------------------------------------------------------------
// Kill Switch
// ---------------------------------------------------------------------------

let killSwitchActive = false;

async function checkKillSwitch(): Promise<boolean> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("performance")
      .select("kill_switch")
      .eq("date", today)
      .single();

    if (error && error.code !== "PGRST116") return false;
    const active = data?.kill_switch === true;

    if (active && !killSwitchActive) {
      console.log("\n🔴 KILL SWITCH ACTIVE — halted");
    }
    if (!active && killSwitchActive) {
      console.log("\n🟢 Kill switch deactivated — resuming\n");
    }

    killSwitchActive = active;
    return active;
  } catch {
    return false;
  }
}

async function checkAutoKillSwitch(): Promise<void> {
  if (killSwitchActive) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: perf } = await supabase
      .from("performance")
      .select("starting_balance, pnl_day")
      .eq("date", today)
      .single();

    if (!perf || !perf.starting_balance || perf.starting_balance <= 0) return;
    const pnlDay = perf.pnl_day ?? 0;
    const drawdownPct = (pnlDay / perf.starting_balance) * 100;

    if (drawdownPct <= -20) {
      console.log(`\n🔴 AUTO KILL: -20% drawdown (${drawdownPct.toFixed(1)}%)`);
      await supabase.from("performance").upsert(
        { date: today, kill_switch: true, drawdown_pct: Math.abs(drawdownPct) / 100 },
        { onConflict: "date" }
      );
      killSwitchActive = true;
      await sendTelegramMessage(
        `*AUTO KILL SWITCH TRIGGERED*\nDrawdown: ${drawdownPct.toFixed(1)}%\nTrading halted.`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ⚠️  Auto kill switch check failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

let totalPolled = 0;
let totalMarketsFound = 0;
let totalFiltered = 0;
let totalSaved = 0;
let totalSignals = 0;
let startTime = Date.now();

function printStats() {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const mins = Math.floor(uptime / 60);
  const secs = uptime % 60;
  console.log(
    `\n📊 Stats — uptime ${mins}m${secs}s | polls: ${totalPolled} | markets: ${totalMarketsFound} | filtered: ${totalFiltered} | saved: ${totalSaved} | signals: ${totalSignals}\n`
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function isSports(title: string): boolean {
  const lower = title.toLowerCase();
  return SPORTS_KEYWORDS.some((kw) => lower.includes(kw));
}

function categorize(title: string): string {
  const lower = title.toLowerCase();
  const ai = ["ai", "artificial intelligence", "openai", "chatgpt", "llm",
    "tech", "apple", "google", "microsoft", "nvidia", "meta",
    "crypto", "bitcoin", "ethereum", "btc", "eth"];
  const politics = ["trump", "biden", "election", "president", "congress",
    "senate", "governor", "vote", "democrat", "republican",
    "political", "policy", "supreme court"];
  if (ai.some((kw) => lower.includes(kw))) return "ai_tech";
  if (politics.some((kw) => lower.includes(kw))) return "politics";
  return "other";
}

// ---------------------------------------------------------------------------
// Supabase saves
// ---------------------------------------------------------------------------

async function saveMarket(m: KalshiMarketFromAPI, yesPrice: number): Promise<string | null> {
  const { data, error } = await supabase
    .from("markets")
    .upsert(
      {
        polymarket_id: m.ticker, // use Kalshi ticker as polymarket_id
        kalshi_ticker: m.ticker,
        title: m.title,
        category: categorize(m.title),
        current_price: yesPrice,
        volume_24h: m.volume_24h ?? m.volume ?? 0,
        status: "active",
      },
      { onConflict: "polymarket_id" }
    )
    .select("id")
    .single();

  if (error) {
    console.error("  ❌ Market save failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// Claude AI Signal — inline analysis (bypasses Cloudflare timeout)
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const MIN_CONFIDENCE = 67;
const MIN_PRICE_GAP = 0.10;
const MAX_EXPIRY_DAYS = 180; // Hard cap — never trade markets expiring beyond this

/**
 * Tiered confidence threshold based on days until market expiry.
 * Short-term markets use normal threshold; longer-dated markets need more conviction.
 * Returns null for markets that should be hard-skipped (same-day or >180 days).
 */
function getDynamicConfidenceThreshold(daysLeft: number): number | null {
  if (daysLeft <= 0) return null;              // same-day — SKIP
  if (daysLeft > MAX_EXPIRY_DAYS) return null; // >180 days — SKIP
  if (daysLeft <= 30) return 67;               // 1-30 days: normal
  if (daysLeft <= 90) return 72;               // 31-90 days: medium term
  return 78;                                   // 91-180 days: high conviction
}

const SIGNAL_SYSTEM_PROMPT = `You are a prediction market analyst for PolyBot. Analyze this Kalshi market and output ONLY valid JSON:
{
  "vote": "YES" or "NO" or "NO_TRADE",
  "probability": 0.00 to 1.00,
  "confidence": 0 to 100,
  "reason": "one sentence max",
  "strategy": "news_lag" or "sentiment_fade" or "logical_arb" or "maker" or "unknown"
}

Confidence calibration (use the FULL 0-100 range):
- 10-25: You have almost no information advantage — pure guess
- 25-40: Weak directional lean but limited supporting evidence
- 40-55: Moderate analysis — some evidence supports your view but significant uncertainty remains
- 55-70: Solid analysis — multiple data points align, clear reasoning, but not certain
- 70-85: Strong conviction — clear mispricing with strong evidence (news, logic, base rates)
- 85-100: Near certain — overwhelming evidence the market is wrong

Rules:
- Vote YES or NO only when confidence >= 67 AND price gap >= 10%
- Otherwise vote NO_TRADE (but still give your honest confidence and probability)
- Your confidence should reflect how much evidence supports your specific probability estimate
- Markets where you lack information should score 10-30, not cluster at 45
- Markets where you have a clear view should score 55-80+
- Consider: base rates, recent news, time to expiration, market efficiency, and your information edge`;

const analyzedMarkets = new Set<string>();

// ---------------------------------------------------------------------------
// Daily P&L check — sum today's closed trade P&L from Supabase
// Returns 0.0 on error (fail open — don't block trades on query failure)
// ---------------------------------------------------------------------------
async function getDailyPnL(): Promise<number> {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("trades")
      .select("pnl")
      .eq("status", "closed")
      .gte("exit_at", todayStart.toISOString());
    if (error || !data) return 0;
    return data.reduce((sum: number, t: { pnl: number | null }) => sum + (t.pnl ?? 0), 0);
  } catch {
    return 0; // Fail open
  }
}

// ---------------------------------------------------------------------------
// Auto-exec — place Kalshi order directly from feed.ts
// Uses the existing kalshiFetch (Node.js native crypto) already in this file.
// ---------------------------------------------------------------------------

async function autoExecTrade(
  kalshiTicker: string,
  side: "yes" | "no",
  marketId: string,
  strategy: string,
  confidence: number,
  yesPrice: number,
  isCrypto: boolean = false,
  cryptoPrices: CryptoPrices | null = null
): Promise<void> {
  try {
    // Paper mode gate
    if (PAPER_MODE) {
      const priceCents = Math.round(yesPrice * 100);
      console.log(`  📝 PAPER: would have bought ${kalshiTicker} ${side.toUpperCase()} @ ${priceCents}c`);
      return;
    }

    // Safety Check 0 — Daily P&L cap
    const dailyPnL = await getDailyPnL();
    if (dailyPnL >= DAILY_PROFIT_TARGET) {
      console.log(`  🎉 DAILY TARGET HIT: +$${dailyPnL.toFixed(2)} today — no new trades`);
      return;
    }
    if (dailyPnL <= DAILY_LOSS_LIMIT) {
      console.log(`  🚫 DAILY LOSS LIMIT: -$${Math.abs(dailyPnL).toFixed(2)} today — no new trades`);
      return;
    }

    // Safety Check 1 — Balance floor + dynamic sizing
    let balanceDollars = 25; // fallback if fetch fails
    try {
      const balData = await kalshiFetch<{ balance: number }>("GET", "/portfolio/balance");
      balanceDollars = balData.balance / 100; // Kalshi returns cents
      if (balanceDollars < MIN_BALANCE_FLOOR) {
        console.log(`  🚫 SKIP AUTO-EXEC: balance too low ($${balanceDollars.toFixed(2)} < $${MIN_BALANCE_FLOOR} floor)`);
        return;
      }
    } catch (balErr) {
      console.warn(`  ⚠️  Balance check failed (using $${balanceDollars} fallback): ${balErr instanceof Error ? balErr.message : String(balErr)}`);
    }

    // Dynamic position sizing based on balance + confidence
    const dynamicTradeSize = calculateTradeSize(balanceDollars, confidence);
    const dynamicMaxPositions = calculateMaxPositions(balanceDollars, dynamicTradeSize);

    // Safety Check 2 — Max positions cap (live from Kalshi, filter by actual exposure)
    try {
      const posData = await kalshiFetch<{
        market_positions: { market_exposure_dollars?: string }[];
      }>(
        "GET",
        "/portfolio/positions?settlement_status=unsettled"
      );
      const allPositions = posData.market_positions ?? [];
      // Only count positions with real exposure (>$0) — settled ones have $0
      const posCount = allPositions.filter(
        (p) => parseFloat(String(p.market_exposure_dollars ?? "0")) > 0
      ).length;
      console.log(`  📊 Kalshi positions: ${posCount} open (${allPositions.length} total unsettled) | max: ${dynamicMaxPositions} | size: $${dynamicTradeSize}`);
      if (posCount >= dynamicMaxPositions) {
        console.log(`  🚫 SKIP AUTO-EXEC: max positions reached (${posCount}/${dynamicMaxPositions})`);
        return;
      }
    } catch (posErr) {
      console.warn(`  ⚠️  Positions check failed (continuing): ${posErr instanceof Error ? posErr.message : String(posErr)}`);
    }

    // Fetch live market data to get current ask price for immediate fill
    const mktRaw = await kalshiFetch<Record<string, unknown>>(
      "GET",
      `/markets/${encodeURIComponent(kalshiTicker)}`
    );
    const mkt = (mktRaw.market ?? mktRaw) as Record<string, unknown>;

    let priceCents: number;
    if (side === "yes") {
      const askDollars = mkt.yes_ask_dollars as number | undefined;
      const askCentsRaw = mkt.yes_ask as number | undefined;
      if (askDollars && askDollars > 0) {
        priceCents = Math.round(askDollars * 100);
      } else if (askCentsRaw && askCentsRaw > 0) {
        priceCents = askCentsRaw;
      } else {
        priceCents = Math.round(yesPrice * 100);
      }
    } else {
      const askDollars = mkt.no_ask_dollars as number | undefined;
      const askCentsRaw = mkt.no_ask as number | undefined;
      if (askDollars && askDollars > 0) {
        priceCents = Math.round(askDollars * 100);
      } else if (askCentsRaw && askCentsRaw > 0) {
        priceCents = askCentsRaw;
      } else {
        priceCents = Math.round((1 - yesPrice) * 100);
      }
    }

    // Sanity: price must be 1-99 cents
    if (priceCents < 1 || priceCents > 99) {
      console.error(`  ❌ AUTO-EXEC FAILED: ${kalshiTicker} invalid price ${priceCents}c`);
      return;
    }

    // Safety Check 3 — Dynamic trade cost check
    const tradeCostPerContract = priceCents / 100;
    if (tradeCostPerContract > dynamicTradeSize) {
      console.log(`  🚫 SKIP AUTO-EXEC: price $${tradeCostPerContract.toFixed(2)} exceeds dynamic size $${dynamicTradeSize} (bal:$${balanceDollars.toFixed(2)} conf:${confidence}%)`);
      return;
    }

    // Dynamic contract count — buy as many contracts as dynamicTradeSize allows
    const count = Math.max(1, Math.floor(dynamicTradeSize / tradeCostPerContract));
    const totalCost = (count * tradeCostPerContract);

    const body = {
      ticker: kalshiTicker,
      action: "buy",
      side,
      count,
      type: "limit",
      ...(side === "yes" ? { yes_price: priceCents } : { no_price: priceCents }),
    };

    console.log(`  🤖 AUTO-EXEC: placing ${side.toUpperCase()} on ${kalshiTicker} @ ${priceCents}c | size: $${totalCost.toFixed(2)} (${count} contracts) | max-pos: ${dynamicMaxPositions} (conf: ${confidence}%)`);

    const data = await kalshiFetch<Record<string, unknown>>("POST", "/portfolio/orders", body);

    // Extract order ID — Kalshi may return { order: { order_id } } or { order_id }
    const orderObj = data.order as Record<string, unknown> | undefined;
    const orderId =
      (orderObj?.order_id as string) ??
      (data.order_id as string) ??
      null;

    if (!orderId) {
      console.error(`  ❌ AUTO-EXEC FAILED: ${kalshiTicker} no order_id in response`);
      return;
    }

    console.log(`  ✅ AUTO-EXEC: ${kalshiTicker} ${side.toUpperCase()} @ ${priceCents}c x${count} ($${totalCost.toFixed(2)}) | order ${orderId}`);

    // Telegram alert for trade execution
    sendTelegramMessage(
      `*🤖 Trade Executed*\n\nMarket: ${kalshiTicker}\nSide: ${side.toUpperCase()}\nPrice: ${priceCents}c\nContracts: ${count}\nCost: $${totalCost.toFixed(2)}\nConfidence: ${confidence}%\nOrder: ${orderId}`
    ).catch(() => {});

    // Save trade to Supabase
    // For crypto markets, ensure market exists first (may not have been saved via saveMarket)
    let tradeMarketId = marketId;
    if (isCrypto && !marketId) {
      // Crypto market might not have a markets table entry — upsert one now
      const { data: mktData, error: mktErr } = await supabase
        .from("markets")
        .upsert(
          {
            polymarket_id: kalshiTicker,
            kalshi_ticker: kalshiTicker,
            title: kalshiTicker,
            category: "crypto",
            current_price: yesPrice,
            volume_24h: 0,
            status: "active",
          },
          { onConflict: "polymarket_id" }
        )
        .select("id")
        .single();
      if (mktErr) {
        console.error(`  ❌ TRADE SAVE FAILED: ${kalshiTicker} market upsert error: ${mktErr.message}`);
      } else {
        tradeMarketId = mktData?.id ?? marketId;
      }
    }

    // Derive trade context for memory system
    const tickerLow = kalshiTicker.toLowerCase();
    let tradeCoin = "OTHER";
    let tradeCoinPrice = 0;
    if (tickerLow.startsWith("kxbtcd") || tickerLow.startsWith("kxbtc15m")) {
      tradeCoin = "BTC";
      tradeCoinPrice = cryptoPrices?.btc ?? 0;
    } else if (tickerLow.startsWith("kxethd")) {
      tradeCoin = "ETH";
      tradeCoinPrice = cryptoPrices?.eth ?? 0;
    } else if (tickerLow.startsWith("kxsold")) {
      tradeCoin = "SOL";
      tradeCoinPrice = cryptoPrices?.sol ?? 0;
    } else if (tickerLow.startsWith("kxxrpd")) {
      tradeCoin = "XRP";
      tradeCoinPrice = cryptoPrices?.xrp ?? 0;
    } else if (tickerLow.startsWith("kxdoged")) {
      tradeCoin = "DOGE";
      tradeCoinPrice = cryptoPrices?.doge ?? 0;
    } else if (tickerLow.startsWith("kxbnbd")) {
      tradeCoin = "BNB";
      tradeCoinPrice = cryptoPrices?.bnb ?? 0;
    }
    const threshMatch = kalshiTicker.match(/-T([\d.]+)$/);
    const tradeThreshold = threshMatch ? parseFloat(threshMatch[1]) : 0;
    const tradeDistance = tradeCoinPrice > 0 && tradeThreshold > 0
      ? Math.abs(tradeThreshold - tradeCoinPrice)
      : null;
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hourET = nowET.getHours();

    const { error: tradeErr } = await supabase.from("trades").insert({
      market_id: tradeMarketId,
      direction: side,
      entry_price: yesPrice,
      shares: count,
      entry_cost: totalCost,
      strategy: strategy ?? "unknown",
      status: "open",
      notes: `AUTO-EXEC: ${orderId} | ${kalshiTicker} | conf:${confidence}% | ${count}x@${priceCents}c`,
      hour_et: hourET,
      btc_trend_at_entry: cryptoPrices?.btcTrend5m ?? null,
      coin: tradeCoin,
      threshold_distance: tradeDistance,
    });
    if (tradeErr) {
      console.error(`  ❌ TRADE SAVE FAILED: ${kalshiTicker} ${tradeErr.message}`);
    } else {
      console.log(`  ✅ TRADE SAVED: ${kalshiTicker} ${side.toUpperCase()} @ ${priceCents}c → Supabase`);
    }

    // Mark signal as acted on (best-effort — don't crash if this fails)
    try {
      await supabase
        .from("signals")
        .update({ acted_on: true })
        .eq("market_id", marketId)
        .order("created_at", { ascending: false })
        .limit(1);
    } catch {
      // Silent — marking acted_on is non-critical
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ AUTO-EXEC FAILED: ${kalshiTicker} ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Auto-sell — take profit on open positions
// Runs once per poll cycle, checks all open Kalshi positions for 25%+ gain
// ---------------------------------------------------------------------------

async function checkAndSellPositions(): Promise<void> {
  if (killSwitchActive) return;
  if (PAPER_MODE) return; // No positions to sell in paper mode

  try {
    // Fetch open positions from Kalshi
    const posData = await kalshiFetch<{
      market_positions: {
        ticker: string;
        market_exposure_dollars: string;
        position_fp: string;
      }[];
    }>("GET", "/portfolio/positions?settlement_status=unsettled&limit=20");

    const positions = posData.market_positions ?? [];
    if (positions.length === 0) return;

    console.log(`  💰 Checking ${positions.length} open positions for take-profit...`);

    for (const pos of positions) {
      try {
        const ticker = pos.ticker;
        const posFp = parseFloat(String(pos.position_fp));
        const side: "yes" | "no" = posFp < 0 ? "no" : "yes";
        const contracts = Math.abs(posFp);
        if (contracts === 0) continue;

        // Look up entry cost from Supabase trades table via markets table
        // markets.polymarket_id = ticker, trades.market_id = markets.id
        const { data: marketRow } = await supabase
          .from("markets")
          .select("id")
          .eq("polymarket_id", ticker)
          .single();

        if (!marketRow) {
          console.log(`  ⚠️  TAKE-PROFIT: ${ticker} — no market row in Supabase, skipping`);
          continue;
        }

        const { data: tradeRow } = await supabase
          .from("trades")
          .select("id, entry_cost, direction")
          .eq("market_id", marketRow.id)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!tradeRow || !tradeRow.entry_cost) {
          // Silent skip — orphaned position from before auto-exec tracking
          continue;
        }

        const entryCostDollars = parseFloat(String(tradeRow.entry_cost));
        if (entryCostDollars <= 0 || isNaN(entryCostDollars)) continue;

        // Fetch current market bid price for the side we hold
        const mktRaw = await kalshiFetch<Record<string, unknown>>(
          "GET",
          `/markets/${encodeURIComponent(ticker)}`
        );
        const mkt = (mktRaw.market ?? mktRaw) as Record<string, unknown>;

        let currentBidCents: number;
        if (side === "yes") {
          const bidDollars = mkt.yes_bid_dollars as number | undefined;
          const bidCentsRaw = mkt.yes_bid as number | undefined;
          if (bidDollars && bidDollars > 0) {
            currentBidCents = Math.round(bidDollars * 100);
          } else if (bidCentsRaw && bidCentsRaw > 0) {
            currentBidCents = bidCentsRaw;
          } else {
            console.log(`  ⚠️  TAKE-PROFIT: ${ticker} — no bid price available, skipping`);
            continue;
          }
        } else {
          const bidDollars = mkt.no_bid_dollars as number | undefined;
          const bidCentsRaw = mkt.no_bid as number | undefined;
          if (bidDollars && bidDollars > 0) {
            currentBidCents = Math.round(bidDollars * 100);
          } else if (bidCentsRaw && bidCentsRaw > 0) {
            currentBidCents = bidCentsRaw;
          } else {
            console.log(`  ⚠️  TAKE-PROFIT: ${ticker} — no bid price available, skipping`);
            continue;
          }
        }

        const currentBidDollars = currentBidCents / 100;
        const gainPct = ((currentBidDollars - entryCostDollars) / entryCostDollars) * 100;

        // 3-way decision: take profit, stop loss, or hold
        let sellReason: "take-profit" | "stop-loss" | null = null;
        if (gainPct >= TAKE_PROFIT_PCT) {
          sellReason = "take-profit";
          console.log(`  💰 TAKE PROFIT: ${ticker} ${side.toUpperCase()} entry=${(entryCostDollars * 100).toFixed(0)}c current=${currentBidCents}c gain=${gainPct.toFixed(1)}% — SELLING`);
        } else if (gainPct <= STOP_LOSS_PCT) {
          sellReason = "stop-loss";
          console.log(`  🛑 STOP LOSS: ${ticker} ${side.toUpperCase()} entry=${(entryCostDollars * 100).toFixed(0)}c current=${currentBidCents}c loss=${gainPct.toFixed(1)}% — SELLING`);
        } else {
          console.log(`  📊 HOLD: ${ticker} ${side.toUpperCase()} entry=${(entryCostDollars * 100).toFixed(0)}c current=${currentBidCents}c gain=${gainPct.toFixed(1)}% (TP:${TAKE_PROFIT_PCT}% SL:${STOP_LOSS_PCT}%)`);
          continue;
        }

        // Sell order (shared by take-profit and stop-loss)
        const sellBody = {
          ticker,
          action: "sell",
          side,
          count: Math.round(contracts),
          type: "limit",
          ...(side === "yes" ? { yes_price: currentBidCents } : { no_price: currentBidCents }),
        };

        const sellData = await kalshiFetch<Record<string, unknown>>("POST", "/portfolio/orders", sellBody);

        const orderObj = sellData.order as Record<string, unknown> | undefined;
        const orderId =
          (orderObj?.order_id as string) ??
          (sellData.order_id as string) ??
          null;

        if (!orderId) {
          console.error(`  ❌ ${sellReason.toUpperCase()} SELL FAILED: ${ticker} no order_id in response`);
          continue;
        }

        const gainSign = gainPct >= 0 ? "+" : "";
        console.log(`  ✅ SOLD: ${ticker} ${side.toUpperCase()} @ ${currentBidCents}c | order ${orderId} | ${gainSign}${gainPct.toFixed(1)}% [${sellReason}]`);

        // Update Supabase trade: mark closed, record exit price + PnL
        const pnl = currentBidDollars - entryCostDollars;
        const pnlPct = gainPct / 100;
        try {
          await supabase
            .from("trades")
            .update({
              status: "closed",
              exit_price: currentBidDollars,
              exit_value: currentBidDollars,
              pnl,
              pnl_pct: pnlPct,
              exit_at: new Date().toISOString(),
              notes: `${sellReason.toUpperCase()}: ${orderId} | ${gainSign}${gainPct.toFixed(1)}%`,
              outcome: pnl > 0 ? "win" : "loss",
            })
            .eq("id", tradeRow.id);
        } catch {
          console.error(`  ⚠️  Trade update failed for ${ticker}`);
        }

        // Telegram alert
        const tgEmoji = sellReason === "take-profit" ? "💰 PROFIT TAKEN" : "🛑 STOP LOSS HIT";
        sendTelegramMessage(
          `*${tgEmoji}*\n\nTicker: ${ticker}\nSide: ${side.toUpperCase()}\nEntry: ${(entryCostDollars * 100).toFixed(0)}c\nExit: ${currentBidCents}c\nGain: ${gainSign}${gainPct.toFixed(1)}%\nP&L: ${gainSign}$${Math.abs(pnl).toFixed(2)}`
        ).catch(() => {});

      } catch (posErr) {
        const msg = posErr instanceof Error ? posErr.message : String(posErr);
        console.error(`  ⚠️  TAKE-PROFIT check failed for ${pos.ticker}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ⚠️  checkAndSellPositions failed: ${msg}`);
  }
}

interface ClaudeSignal {
  vote: "YES" | "NO" | "NO_TRADE";
  probability: number;
  confidence: number;
  reason: string;
  strategy: string;
}

async function analyzeMarket(
  marketId: string,
  kalshiTicker: string,
  title: string,
  category: string,
  yesPrice: number,
  volume: number,
  expirationRaw: string,
  btcPrice: string,
  memoryContext: string = "",
  confThreshold: number = MIN_CONFIDENCE,
  cryptoPrices: CryptoPrices | null = null,
  isCrypto: boolean = false
): Promise<void> {
  if (killSwitchActive || !anthropic) return;
  if (analyzedMarkets.has(kalshiTicker)) return;

  analyzedMarkets.add(kalshiTicker);
  console.log(`  🔄 Claude → ${title.slice(0, 60)}...`);

  try {
    // Build date context so Claude knows when "now" is and when market expires
    const todayStr = new Date().toISOString().split("T")[0];
    let expiryContext = "";
    if (expirationRaw) {
      const expiryDate = new Date(expirationRaw);
      if (!isNaN(expiryDate.getTime())) {
        const expiryStr = expiryDate.toISOString().split("T")[0];
        const daysLeft = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        expiryContext = `\nThis market expires on ${expiryStr}. Days until expiration: ${daysLeft}. Required confidence threshold: ${confThreshold}% (higher for longer-dated markets).`;
      }
    }

    const userPrompt = `Today is ${todayStr}.${expiryContext}
${memoryContext}
Market: ${title}
Kalshi Ticker: ${kalshiTicker}
Category: ${category}
Current YES price: ${yesPrice.toFixed(2)} (implied probability: ${(yesPrice * 100).toFixed(1)}%)
Volume: $${volume.toLocaleString()}${btcPrice ? `\nCurrent BTC price: $${btcPrice}` : ""}${
      (() => {
        if (!cryptoPrices) return "";
        const t = kalshiTicker.toLowerCase();
        const isCrypto = t.includes("updown") || t.startsWith("kxbtc15m") || t.startsWith("kxbtcd") || t.startsWith("kxethd") || t.startsWith("kxsold") || t.startsWith("kxxrpd") || t.startsWith("kxdoged") || t.startsWith("kxbnbd");
        if (!isCrypto) return "";
        return `\nLIVE MARKET DATA (Coinbase): BTC=$${cryptoPrices.btc.toLocaleString()} (${cryptoPrices.btcTrend5m >= 0 ? "+" : ""}${cryptoPrices.btcTrend5m.toFixed(2)}% 5min). ETH=$${cryptoPrices.eth.toLocaleString()}. SOL=$${cryptoPrices.sol.toFixed(0)}. XRP=$${cryptoPrices.xrp.toFixed(2)}. DOGE=$${cryptoPrices.doge.toFixed(4)}. BNB=$${cryptoPrices.bnb.toFixed(0)}. Use the 5-min trend to assess UP or DOWN direction for the next 15 minutes. Rising momentum = lean UP. Falling momentum = lean DOWN.`;
      })()
    }

What is your analysis?`;

    const claudeStart = Date.now();
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 256,
      system: SIGNAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.3,
    });
    const claudeMs = Date.now() - claudeStart;

    const content = res.content[0]?.type === "text" ? res.content[0].text : "";
    console.log(`  📝 Claude raw: ${content.slice(0, 200)}`);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("  ⚠️  No JSON in Claude response");
      return;
    }

    let parsed: ClaudeSignal;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error(`  ⚠️  JSON parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      return;
    }

    // Validate required fields — skip if missing
    if (!parsed.vote || parsed.confidence == null || parsed.probability == null) {
      console.error(`  ⚠️  Missing fields: vote=${parsed.vote} conf=${parsed.confidence} prob=${parsed.probability}`);
      return;
    }

    const vote = String(parsed.vote).toUpperCase();
    if (!["YES", "NO", "NO_TRADE"].includes(vote)) return;

    const confidence = Math.max(0, Math.min(100, Math.round(parseFloat(String(parsed.confidence)))));
    const probability = Math.max(0, Math.min(1, parseFloat(String(parsed.probability))));

    // Guard against NaN from bad parsing
    if (isNaN(confidence) || isNaN(probability)) {
      console.error(`  ⚠️  NaN detected: conf=${parsed.confidence} prob=${parsed.probability}`);
      return;
    }

    const priceGap = Math.abs(probability - yesPrice);

    const finalVote =
      confidence < confThreshold || priceGap < MIN_PRICE_GAP ? "NO_TRADE" : vote;

    const validStrategies = ["news_lag", "sentiment_fade", "logical_arb", "maker", "unknown"];
    const strategy = validStrategies.includes(parsed.strategy) ? parsed.strategy : "unknown";

    const signalPayload = {
      market_id: marketId,
      strategy,
      claude_vote: finalVote,
      gpt4o_vote: null,
      gemini_vote: null,
      consensus: finalVote,
      confidence,
      ai_probability: probability,
      market_price: yesPrice,
      price_gap: priceGap,
      reasoning: String(parsed.reason ?? ""),
      acted_on: false,
    };

    const { error } = await supabase.from("signals").insert(signalPayload);
    if (error) {
      console.error("  ❌ Signal save failed:", error.message);
      return;
    }

    totalSignals++;
    const voteColor = finalVote === "YES" ? "🟢" : finalVote === "NO" ? "🔴" : "⚪";
    console.log(
      `  ${voteColor} ${finalVote} | conf ${confidence}% | gap ${(priceGap * 100).toFixed(1)}% | ${claudeMs}ms | ${parsed.reason?.slice(0, 50)}`
    );

    // Auto-exec + Telegram alert for actionable signals
    if (finalVote !== "NO_TRADE" && confidence >= confThreshold && priceGap >= MIN_PRICE_GAP) {
      // Auto-execute the trade
      const side: "yes" | "no" = finalVote === "YES" ? "yes" : "no";
      await autoExecTrade(kalshiTicker, side, marketId, strategy, confidence, yesPrice, isCrypto, cryptoPrices);

      const modeTag = PAPER_MODE ? "📝 PAPER" : "🤖 AUTO-EXECUTED";
      const alertMsg = [
        `*PolyBot Signal — ${modeTag}*`,
        ``,
        `Market: ${title.slice(0, 60)}`,
        `Ticker: ${kalshiTicker}`,
        `Signal: ${finalVote}`,
        `Confidence: ${confidence}%`,
        `Price: ${(yesPrice * 100).toFixed(0)}c`,
        `Strategy: ${strategy}`,
        ``,
        `polybot-app.pages.dev/bot`,
      ].join("\n");
      sendTelegramMessage(alertMsg).catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ⚠️  Claude analysis failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Memory context — positions + trade history for Claude awareness
// ---------------------------------------------------------------------------

async function buildMemoryContext(): Promise<string> {
  const lines: string[] = [];
  try {
    // Layer 1 — Open positions from Kalshi
    try {
      const posData = await kalshiFetch<{ market_positions: { ticker: string; market_exposure_dollars: string; position_fp: string }[] }>(
        "GET",
        "/portfolio/positions?settlement_status=unsettled&limit=20"
      );
      const positions = posData.market_positions ?? [];
      const openPos = positions.filter(
        (p) => parseFloat(String(p.market_exposure_dollars ?? "0")) > 0
      );
      if (openPos.length > 0) {
        lines.push("YOUR OPEN POSITIONS (do NOT re-enter these markets):");
        for (const p of openPos.slice(0, 5)) {
          const side = parseFloat(String(p.position_fp)) < 0 ? "NO" : "YES";
          const exposure = parseFloat(String(p.market_exposure_dollars ?? "0")).toFixed(2);
          lines.push(`- ${side} on ${p.ticker} — $${exposure} exposure`);
        }
      }
    } catch (posErr) {
      console.log(`  ⚠️  Memory: positions fetch failed (continuing): ${posErr instanceof Error ? posErr.message : String(posErr)}`);
    }

    // Layer 2 — Pattern analysis from ALL Kalshi settled positions
    // This pulls from Kalshi API directly, not just Supabase-tracked trades
    let kalshiPatternsDone = false;
    try {
      const settledData = await kalshiFetch<{
        market_positions: {
          ticker: string;
          realized_pnl: string;
          market_exposure_dollars: string;
          position_fp: string;
        }[];
      }>("GET", "/portfolio/positions?settlement_status=settled&limit=200");

      const settled = settledData.market_positions ?? [];
      if (settled.length >= 3) {
        kalshiPatternsDone = true;

        // Classify each settled trade
        interface SettledTrade {
          ticker: string;
          coin: string;
          pnl: number;
          won: boolean;
          threshold: number;
          distance: number; // will be 0 if we can't determine
        }

        const trades: SettledTrade[] = [];
        for (const s of settled) {
          const pnl = parseFloat(String(s.realized_pnl ?? "0"));
          const t = s.ticker.toLowerCase();

          // Determine coin from ticker
          let coin = "OTHER";
          if (t.startsWith("kxbtcd") || t.startsWith("kxbtc15m") || t.startsWith("kxbtcw")) coin = "BTC";
          else if (t.startsWith("kxethd") || t.startsWith("kxethw")) coin = "ETH";
          else if (t.startsWith("kxsold")) coin = "SOL";
          else if (t.startsWith("kxxrpd")) coin = "XRP";
          else if (t.startsWith("kxdoged")) coin = "DOGE";
          else if (t.startsWith("kxbnbd")) coin = "BNB";

          // Parse threshold from ticker
          const threshMatch = s.ticker.match(/-T([\d.]+)$/);
          const threshold = threshMatch ? parseFloat(threshMatch[1]) : 0;

          trades.push({
            ticker: s.ticker,
            coin,
            pnl,
            won: pnl > 0,
            threshold,
            distance: 0, // unknown at settlement time
          });
        }

        // Filter to crypto trades only (skip politics/sports from early days)
        const cryptoTrades = trades.filter((t) => t.coin !== "OTHER");
        const allTrades = cryptoTrades.length >= 3 ? cryptoTrades : trades;

        const wins = allTrades.filter((t) => t.won);
        const losses = allTrades.filter((t) => !t.won);
        const total = allTrades.length;
        const winRate = total > 0 ? Math.round((wins.length / total) * 100) : 0;
        const totalPnl = allTrades.reduce((sum, t) => sum + t.pnl, 0);

        lines.push("");
        lines.push(`TRADE HISTORY (Kalshi settlements): ${total} trades | ${wins.length}W ${losses.length}L | ${winRate}% win rate | P&L: $${totalPnl.toFixed(2)}`);

        // By coin
        const coinList = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"];
        const coinStats: string[] = [];
        for (const c of coinList) {
          const ct = allTrades.filter((t) => t.coin === c);
          if (ct.length === 0) continue;
          const cw = ct.filter((t) => t.won).length;
          const wr = Math.round((cw / ct.length) * 100);
          const edge = wr >= 75 ? "strong edge" : wr >= 50 ? "moderate" : "WEAK — trade cautiously";
          coinStats.push(`${c}: ${cw}/${ct.length} (${wr}%) ${edge}`);
        }
        if (coinStats.length > 0) {
          lines.push("BY COIN: " + coinStats.join(" | "));
        }

        // By threshold distance for BTC trades
        const btcTrades = allTrades.filter((t) => t.coin === "BTC" && t.threshold > 0);
        if (btcTrades.length >= 3) {
          const tightTrades = btcTrades.filter((t) => t.threshold > 0 && t.threshold < 70000); // rough proxy for "tight"
          const wideTrades = btcTrades.filter((t) => t.threshold >= 72000); // rough proxy for "wide"
          const distStats: string[] = [];
          if (tightTrades.length > 0) {
            const tw = tightTrades.filter((t) => t.won).length;
            distStats.push(`Low threshold(<$70K): ${tw}/${tightTrades.length} (${Math.round((tw / tightTrades.length) * 100)}%)`);
          }
          if (wideTrades.length > 0) {
            const ww = wideTrades.filter((t) => t.won).length;
            distStats.push(`High threshold(>$72K): ${ww}/${wideTrades.length} (${Math.round((ww / wideTrades.length) * 100)}%)`);
          }
          if (distStats.length > 0) {
            lines.push("BTC BY THRESHOLD: " + distStats.join(" | "));
          }
        }

        // Recent momentum — last 10 trades
        const recent10 = allTrades.slice(0, 10);
        if (recent10.length >= 5) {
          const r10Wins = recent10.filter((t) => t.won).length;
          const r10Wr = Math.round((r10Wins / recent10.length) * 100);
          const streak = r10Wr >= 80 ? "HOT STREAK 🔥" : r10Wr >= 60 ? "solid" : r10Wr >= 40 ? "mixed" : "COLD — tighten filters";
          lines.push(`RECENT MOMENTUM (last ${recent10.length}): ${r10Wins}/${recent10.length} (${r10Wr}%) — ${streak}`);
        }

        // Biggest wins and losses
        const sortedByPnl = [...allTrades].sort((a, b) => b.pnl - a.pnl);
        const biggestWin = sortedByPnl[0];
        const biggestLoss = sortedByPnl[sortedByPnl.length - 1];
        if (biggestWin && biggestWin.pnl > 0) {
          lines.push(`BIGGEST WIN: $${biggestWin.pnl.toFixed(2)} on ${biggestWin.ticker}`);
        }
        if (biggestLoss && biggestLoss.pnl < 0) {
          lines.push(`BIGGEST LOSS: -$${Math.abs(biggestLoss.pnl).toFixed(2)} on ${biggestLoss.ticker}`);
        }

        // Recent losses (last 3)
        const recentLosses = losses.slice(0, 3);
        if (recentLosses.length > 0) {
          lines.push("RECENT LOSSES (avoid similar setups):");
          for (const l of recentLosses) {
            lines.push(`- ${l.coin} lost $${Math.abs(l.pnl).toFixed(2)} on ${l.ticker}`);
          }
        }
      }
    } catch (kalshiErr) {
      console.log(`  ⚠️  Memory: Kalshi settlements fetch failed (falling back to Supabase): ${kalshiErr instanceof Error ? kalshiErr.message : String(kalshiErr)}`);
    }

    // Layer 2 fallback — Supabase trades (if Kalshi settlements failed or returned < 3)
    if (!kalshiPatternsDone) {
      try {
        const { data: closedTrades } = await supabase
          .from("trades")
          .select("coin, hour_et, btc_trend_at_entry, outcome, pnl, notes, created_at")
          .not("outcome", "is", null)
          .order("created_at", { ascending: false })
          .limit(50);

        if (closedTrades && closedTrades.length >= 3) {
          const wins = closedTrades.filter((t) => t.outcome === "win");
          const losses = closedTrades.filter((t) => t.outcome === "loss");
          const total = closedTrades.length;
          const winRate = total > 0 ? Math.round((wins.length / total) * 100) : 0;
          lines.push("");
          lines.push(`TRADE PATTERNS (Supabase): ${total} closed | ${wins.length}W ${losses.length}L | ${winRate}% win rate`);

          // By coin
          const coins = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"];
          const coinStats: string[] = [];
          for (const c of coins) {
            const coinTrades = closedTrades.filter((t) => t.coin === c);
            if (coinTrades.length === 0) continue;
            const coinWins = coinTrades.filter((t) => t.outcome === "win").length;
            const coinWr = Math.round((coinWins / coinTrades.length) * 100);
            const edge = coinWr >= 75 ? "strong" : coinWr >= 50 ? "moderate" : "weak";
            coinStats.push(`${c}: ${coinTrades.length} trades, ${coinWins}W (${coinWr}%) — ${edge}`);
          }
          if (coinStats.length > 0) {
            lines.push("BY COIN: " + coinStats.join(" | "));
          }

          // Recent losses
          const recentLosses = losses.slice(0, 3);
          if (recentLosses.length > 0) {
            lines.push("RECENT LOSSES:");
            for (const l of recentLosses) {
              const coin = l.coin ?? "?";
              const loss = l.pnl != null ? `$${Math.abs(l.pnl).toFixed(2)}` : "?";
              lines.push(`- ${coin} lost ${loss}`);
            }
          }
        }
      } catch { /* silent fallback */ }
    }
  } catch {
    // Total failure — return empty, don't break the feed
  }

  if (lines.length === 0) return "";
  return `\n--- TRADE MEMORY (do NOT ignore) ---\n${lines.join("\n")}\n--- END TRADE MEMORY ---\n`;
}

// ---------------------------------------------------------------------------
// Live crypto prices — Coinbase API (no key needed, US-friendly)
// Returns null if any fetch fails (fail open — updown markets still analyzed, just without price data)
// ---------------------------------------------------------------------------
interface CryptoPrices {
  btc: number; eth: number; sol: number; xrp: number; doge: number; bnb: number;
  btcTrend5m: number;   // percent change over last 5 minutes
  btcTrend15m: number;  // percent change over last 15 minutes
  btcTrend1h: number;   // percent change over last 1 hour
  btcChange24h: number; // percent change over last 24 hours
}

async function fetchLiveCryptoPrices(): Promise<CryptoPrices | null> {
  try {
    const requiredCoins = ["BTC", "ETH", "SOL", "XRP"] as const;
    const optionalCoins = ["DOGE", "BNB"] as const;
    const allCoins = [...requiredCoins, ...optionalCoins];
    const spots: Record<string, number> = {};

    // Fetch spot prices in parallel (5s timeout each)
    const spotResults = await Promise.all(
      allCoins.map(async (coin) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(
            `https://api.coinbase.com/v2/prices/${coin}-USD/spot`,
            { signal: controller.signal }
          );
          if (!res.ok) return null;
          const data = (await res.json()) as { data: { amount: string } };
          return { coin, price: parseFloat(data.data.amount) };
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      })
    );

    for (const r of spotResults) {
      if (!r || isNaN(r.price)) {
        // Required coins must succeed; optional coins fail open with 0
        if (r === null) continue; // unknown which coin failed — check below
        spots[r.coin] = 0;
        continue;
      }
      spots[r.coin] = r.price;
    }
    // Verify required coins are present
    for (const c of requiredCoins) {
      if (!spots[c] || spots[c] <= 0) return null;
    }
    // Default optional coins to 0 if missing
    for (const c of optionalCoins) {
      if (!spots[c]) spots[c] = 0;
    }

    // Fetch BTC 5-min candles for trend (2 candles, 300s granularity)
    let btcTrend5m = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(
          "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300&limit=2",
          { signal: controller.signal }
        );
        if (res.ok) {
          const candles = (await res.json()) as number[][];
          if (candles.length >= 2) {
            const currentClose = candles[0][4];
            const prevClose = candles[1][4];
            if (prevClose > 0) {
              btcTrend5m = ((currentClose - prevClose) / prevClose) * 100;
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Trend unavailable — continue with 0
    }

    // Fetch BTC 15-min candles for medium trend (2 candles, 900s granularity)
    let btcTrend15m = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(
          "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900&limit=2",
          { signal: controller.signal }
        );
        if (res.ok) {
          const candles = (await res.json()) as number[][];
          if (candles.length >= 2) {
            const currentClose = candles[0][4];
            const prevClose = candles[1][4];
            if (prevClose > 0) {
              btcTrend15m = ((currentClose - prevClose) / prevClose) * 100;
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 15m trend unavailable — continue with 0
    }

    // Fetch BTC 1-hour candles for hourly trend (2 candles, 3600s granularity)
    let btcTrend1h = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(
          "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&limit=2",
          { signal: controller.signal }
        );
        if (res.ok) {
          const candles = (await res.json()) as number[][];
          if (candles.length >= 2) {
            const currentClose = candles[0][4];
            const prevClose = candles[1][4];
            if (prevClose > 0) {
              btcTrend1h = ((currentClose - prevClose) / prevClose) * 100;
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 1h trend unavailable — continue with 0
    }

    // Fetch BTC daily candles for 24h change (2 candles, 86400s granularity)
    let btcChange24h = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(
          "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&limit=2",
          { signal: controller.signal }
        );
        if (res.ok) {
          const candles = (await res.json()) as number[][];
          if (candles.length >= 2) {
            const currentClose = candles[0][4];
            const prevClose = candles[1][4];
            if (prevClose > 0) {
              btcChange24h = ((currentClose - prevClose) / prevClose) * 100;
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 24h change unavailable — continue with 0
    }

    const prices: CryptoPrices = {
      btc: spots.BTC, eth: spots.ETH, sol: spots.SOL, xrp: spots.XRP,
      doge: spots.DOGE, bnb: spots.BNB,
      btcTrend5m, btcTrend15m, btcTrend1h, btcChange24h,
    };

    const t5 = btcTrend5m >= 0 ? "+" : "";
    const t15 = btcTrend15m >= 0 ? "+" : "";
    const t1h = btcTrend1h >= 0 ? "+" : "";
    const t24h = btcChange24h >= 0 ? "+" : "";
    console.log(
      `  💰 Live prices: BTC=$${prices.btc.toLocaleString()} (${t5}${btcTrend5m.toFixed(2)}% 5m, ${t15}${btcTrend15m.toFixed(2)}% 15m, ${t1h}${btcTrend1h.toFixed(2)}% 1h, ${t24h}${btcChange24h.toFixed(1)}% 24h) ` +
      `ETH=$${prices.eth.toLocaleString()} SOL=$${prices.sol.toFixed(0)} XRP=$${prices.xrp.toFixed(2)} DOGE=$${prices.doge.toFixed(4)} BNB=$${prices.bnb.toFixed(0)}`
    );
    return prices;
  } catch {
    console.warn("  ⚠️  Coinbase prices fetch failed — continuing without crypto data");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Kalshi polling loop
// ---------------------------------------------------------------------------

async function pollKalshi(): Promise<void> {
  totalPolled++;
  console.log(`\n🔄 Poll #${totalPolled} — fetching Kalshi events...`);

  try {
    // Fetch BTC price once per poll cycle (free, no auth)
    let btcPrice = "";
    try {
      const btcRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
      if (btcRes.ok) {
        const btcData = (await btcRes.json()) as { price: string };
        btcPrice = parseFloat(btcData.price).toFixed(2);
        console.log(`  ₿ BTC price: $${btcPrice}`);
      }
    } catch {
      console.warn("  ⚠️  BTC price fetch failed — continuing without it");
    }

    // Fetch live crypto prices for updown markets (Coinbase, once per cycle)
    const cryptoPrices = await fetchLiveCryptoPrices();

    // Check open positions for take-profit opportunities (before new analysis)
    await checkAndSellPositions();

    // Build memory context once per poll cycle (positions + trade history)
    const memoryContext = await buildMemoryContext();
    if (memoryContext) {
      console.log(`  🧠 Memory context loaded (${memoryContext.split("\n").length - 2} lines)`);
    }

    // Fetch multiple categories — priority series first, then general, then crypto updown
    const endpoints = [
      "/events?status=open&with_nested_markets=true&limit=200&series_ticker=KXBTC&sort_by=close_time&sort_direction=asc",
      "/events?status=open&with_nested_markets=true&limit=200&series_ticker=KXFED&sort_by=close_time&sort_direction=asc",
      "/events?status=open&with_nested_markets=true&limit=200&sort_by=close_time&sort_direction=asc",
      // Crypto short-term — /markets endpoint with series_ticker (confirmed working)
      "/markets?series_ticker=KXBTCD&status=open&limit=200",   // BTC hourly above/below
      "/markets?series_ticker=KXBTC15M&status=open&limit=200", // BTC 15-min up/down
      "/markets?series_ticker=KXETHD&status=open&limit=200",   // ETH hourly
      "/markets?series_ticker=KXSOLD&status=open&limit=200",   // SOL hourly
      "/markets?series_ticker=KXXRPD&status=open&limit=200",   // XRP hourly
      "/markets?series_ticker=KXDOGED&status=open&limit=200",  // DOGE hourly
      "/markets?series_ticker=KXBNBD&status=open&limit=200",   // BNB hourly
    ];

    let allMarkets: KalshiMarketFromAPI[] = [];
    const seenTickers = new Set<string>();
    let totalEvents = 0;

    for (const endpoint of endpoints) {
      try {
        const data = await kalshiFetch<{
          events: KalshiEvent[];
          markets?: KalshiMarketFromAPI[];
        }>("GET", endpoint);

        let batch: KalshiMarketFromAPI[] = [];
        if (data.markets && data.markets.length > 0) {
          batch = data.markets;
        } else if (data.events) {
          for (const evt of data.events) {
            if (evt.markets) batch.push(...evt.markets);
          }
          totalEvents += data.events.length;
        }

        // Dedup across batches
        for (const m of batch) {
          if (!seenTickers.has(m.ticker)) {
            seenTickers.add(m.ticker);
            allMarkets.push(m);
          }
        }
      } catch (batchErr) {
        console.warn(`  ⚠️  Batch fetch failed for ${endpoint.slice(0, 60)}:`, batchErr instanceof Error ? batchErr.message : String(batchErr));
      }
    }

    totalMarketsFound = allMarkets.length;
    console.log(`  📦 ${allMarkets.length} markets (deduped) from ${totalEvents} events across ${endpoints.length} queries`);

    // Log crypto market count on first poll
    if (totalPolled === 1) {
      const cryptoCount = allMarkets.filter((m) => {
        const t = m.ticker.toLowerCase();
        return t.startsWith("kxbtcd") || t.startsWith("kxbtc15m") || t.startsWith("kxethd") || t.startsWith("kxsold") || t.startsWith("kxxrpd") || t.startsWith("kxdoged") || t.startsWith("kxbnbd");
      }).length;
      console.log(`  🪙 Crypto short-term markets fetched: ${cryptoCount}`);
    }

    // Debug: log first market to see actual API shape
    if (allMarkets.length > 0) {
      const sample = allMarkets[0];
      console.log(`  🔍 Sample market keys: ${Object.keys(sample).join(", ")}`);
      console.log(`  🔍 Sample: ticker=${sample.ticker} status=${sample.status} yes_bid=${sample.yes_bid} yes_ask=${sample.yes_ask} title=${sample.title?.slice(0, 40)}`);
    }

    // Log unique status values for debugging
    const statusCounts = new Map<string, number>();
    for (const m of allMarkets) {
      statusCounts.set(m.status, (statusCounts.get(m.status) ?? 0) + 1);
    }
    console.log(`  📋 Status values: ${[...statusCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);

    // --- Pre-sort: compute daysLeft for each market, then sort ascending ---
    // This ensures short-term markets (highest edge) get analyzed first.
    const marketsWithExpiry = allMarkets.map((m) => {
      const expiryRaw = (m.close_time ?? m.expiration_time ?? m.end_date_iso ?? "") as string;
      let daysLeft = 9999; // default if no expiry found
      if (expiryRaw) {
        const expiryDate = new Date(expiryRaw);
        if (!isNaN(expiryDate.getTime())) {
          daysLeft = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        }
      }
      return { m, daysLeft };
    });
    marketsWithExpiry.sort((a, b) => a.daysLeft - b.daysLeft);

    let processed = 0;
    let skippedStatus = 0;
    let skippedPrice = 0;
    let skippedSports = 0;
    let skippedVolume = 0;
    let skippedExpiry = 0;
    for (const { m, daysLeft } of marketsWithExpiry) {
      // Accept both "open" and "active" as valid tradeable statuses
      if (m.status !== "open" && m.status !== "active") { skippedStatus++; continue; }

      // Detect crypto short-term markets BEFORE expiry filter
      const titleLower = m.title.toLowerCase();
      const tickerLower = m.ticker.toLowerCase();
      const isCryptoShortTerm =
        tickerLower.includes("updown") ||
        tickerLower.startsWith("kxbtc15m") ||
        tickerLower.startsWith("kxbtcd") ||
        tickerLower.startsWith("kxethd") ||
        tickerLower.startsWith("kxsold") ||
        tickerLower.startsWith("kxxrpd") ||
        tickerLower.startsWith("kxdoged") ||
        tickerLower.startsWith("kxbnbd");

      let confThreshold: number;

      if (isCryptoShortTerm) {
        // Crypto short-term markets expire today by design — bypass expiry filter entirely
        confThreshold = 67; // use normal threshold
      } else {
        // Tiered expiry filter — getDynamicConfidenceThreshold returns null for SKIP
        const threshold = getDynamicConfidenceThreshold(daysLeft);
        if (threshold === null) {
          if (daysLeft > MAX_EXPIRY_DAYS) {
            console.log(`  ⏰ SKIP: ${m.ticker} expires in ${daysLeft} days (>180 day cap)`);
          }
          skippedExpiry++;
          totalFiltered++;
          continue;
        }
        confThreshold = threshold;

        // BTC price range filter — skip price range markets (non-crypto only)
        if (
          (m.ticker.startsWith("KXBTC-") && titleLower.includes("price range")) ||
          titleLower.includes("bitcoin price range")
        ) {
          totalFiltered++;
          continue;
        }

        console.log(`  📅 ${m.ticker} daysLeft=${daysLeft} confThreshold=${confThreshold}%`);
      }

      // Price — use last_price_dollars (most reliable from events endpoint)
      // parseFloat ensures string values from API become real numbers
      const yesPrice = parseFloat(
        String(m.last_price_dollars ?? m.previous_price_dollars ?? m.yes_bid_dollars ?? 0)
      );

      // Guard: skip if price is NaN, zero, or out of tradeable range
      if (!yesPrice || isNaN(yesPrice) || yesPrice < PRICE_MIN || yesPrice > PRICE_MAX) {
        skippedPrice++;
        totalFiltered++;
        continue;
      }

      // Volume filter — skip illiquid markets (100+ minimum)
      const vol24h = (m.volume_24h_fp ?? m.volume_24h ?? m.volume ?? 0) as number;
      if (vol24h < 100) {
        skippedVolume++;
        totalFiltered++;
        continue;
      }

      // Sports filter — skip sports markets entirely
      if (isSports(m.title)) {
        skippedSports++;
        totalFiltered++;
        continue;
      }

      // Crypto proximity + volume filters — avoid high-risk trades near current price
      if (isCryptoShortTerm && cryptoPrices) {
        // GUARD 1 — Time-of-day filter: no new crypto trades deep overnight (2am-6am ET / 11pm-3am PT)
        const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const hourET = nowET.getHours();
        const isOvernightET = hourET >= 2 && hourET < 6;
        if (isOvernightET) {
          console.log(`  💤 SKIP: ${m.ticker} overnight trading blocked (${hourET}am ET)`);
          totalFiltered++;
          continue;
        }

        // GUARD 2 — 4-signal pump detector: skip if ANY signal fires
        if (cryptoPrices.btcTrend5m > 0.5) {
          console.log(`  📈 SKIP: ${m.ticker} BTC 5m pump +${cryptoPrices.btcTrend5m.toFixed(2)}% — risky for NO`);
          totalFiltered++;
          continue;
        }
        if (cryptoPrices.btcTrend15m > 0.8) {
          console.log(`  📈 SKIP: ${m.ticker} BTC 15m pump +${cryptoPrices.btcTrend15m.toFixed(2)}% — risky for NO`);
          totalFiltered++;
          continue;
        }
        if (cryptoPrices.btcTrend1h > 1.5) {
          console.log(`  📈 SKIP: ${m.ticker} BTC 1h pump +${cryptoPrices.btcTrend1h.toFixed(2)}% — risky for NO`);
          totalFiltered++;
          continue;
        }
        if (cryptoPrices.btcChange24h > 5.0) {
          console.log(`  📈 SKIP: ${m.ticker} BTC 24h bull run +${cryptoPrices.btcChange24h.toFixed(1)}% — risky for NO`);
          totalFiltered++;
          continue;
        }

        // Higher volume floor for crypto (1000 vs 100 general)
        if (vol24h < 1000) {
          totalFiltered++;
          continue;
        }

        // Parse threshold from ticker: e.g. KXBTCD-26MAR2212-T68899.99 → 68899.99
        const thresholdMatch = m.ticker.match(/-T([\d.]+)$/);
        if (thresholdMatch) {
          const threshold = parseFloat(thresholdMatch[1]);
          // Determine which coin's price to compare against
          let coinPrice = 0;
          if (tickerLower.startsWith("kxbtcd") || tickerLower.startsWith("kxbtc15m")) {
            coinPrice = cryptoPrices.btc;
          } else if (tickerLower.startsWith("kxethd")) {
            coinPrice = cryptoPrices.eth;
          } else if (tickerLower.startsWith("kxsold")) {
            coinPrice = cryptoPrices.sol;
          } else if (tickerLower.startsWith("kxxrpd")) {
            coinPrice = cryptoPrices.xrp;
          } else if (tickerLower.startsWith("kxdoged")) {
            coinPrice = cryptoPrices.doge;
          } else if (tickerLower.startsWith("kxbnbd")) {
            coinPrice = cryptoPrices.bnb;
          }

          if (coinPrice > 0) {
            const distance = Math.abs(coinPrice - threshold);
            // Min/max distance: BTC $150-$3000, ETH $20-$150, SOL $2-$10
            const minDistance = coinPrice > 10000 ? 150 : coinPrice > 500 ? 20 : 2;
            const maxDistance = coinPrice > 10000 ? 3000 : coinPrice > 500 ? 150 : 10;
            if (distance < minDistance) {
              console.log(`  ⚡ SKIP: ${m.ticker} too close ($${distance.toFixed(0)} < $${minDistance} min)`);
              totalFiltered++;
              continue;
            }
            if (distance > maxDistance) {
              totalFiltered++;
              continue;
            }

            // Direction filter — only trade NO on thresholds ABOVE current price
            // Threshold ABOVE price → betting price won't jump up → safe NO ✅
            // Threshold BELOW price → betting price drops → wrong direction ❌
            if (threshold < coinPrice) {
              console.log(`  ⬇️ SKIP: ${m.ticker} threshold $${threshold.toFixed(0)} below current price $${coinPrice.toFixed(0)} — wrong direction`);
              totalFiltered++;
              continue;
            }
          }
        }

        // YES price sweet spot filter — best risk/reward at 10c-55c
        // YES < 10c → NO costs 90c+ (minimal profit) → SKIP
        // YES > 55c → threshold too likely to hit → risky for NO → SKIP
        // YES 10c-55c → NO pays 45c-90c → SWEET SPOT → ANALYZE ✅
        const yesCents = Math.round(yesPrice * 100);
        if (yesCents < 10 || yesCents > 55) {
          console.log(`  💰 SKIP: ${m.ticker} YES price ${yesCents}c outside 10c-55c sweet spot`);
          totalFiltered++;
          continue;
        }

        // Log only crypto markets that survive all filters (volume + distance + price + direction)
        console.log(`  🪙 CRYPTO PASS: ${m.ticker} daysLeft=${daysLeft} confThreshold=${confThreshold}% YES=${yesCents}c`);
      }

      // Categorize for labeling (not filtering — let Claude decide)
      const category = categorize(m.title);

      // Save market to Supabase (with kalshi_ticker)
      const marketId = await saveMarket(m, yesPrice);
      if (!marketId) continue;
      totalSaved++;
      processed++;

      console.log(
        `  📈 ${m.ticker} | ${(yesPrice * 100).toFixed(0)}c | vol:${vol24h} | [${category}] ${m.title.slice(0, 50)}`
      );

      // CRYPTO-ONLY: skip Claude analysis for non-crypto markets (saves ~20+ API calls/cycle)
      if (!isCryptoShortTerm) {
        continue;
      }

      // Analyze with Claude (confThreshold from tiered expiry system)
      const expirationRaw = String(m.close_time ?? m.expiration_time ?? m.end_date_iso ?? "");
      await analyzeMarket(
        marketId,
        m.ticker,
        m.title,
        category,
        yesPrice,
        vol24h,
        expirationRaw,
        btcPrice,
        memoryContext,
        confThreshold,
        cryptoPrices,
        isCryptoShortTerm
      );
    }

    console.log(`  ✅ Processed ${processed} | skipped: status=${skippedStatus} expiry=${skippedExpiry} price=${skippedPrice} volume=${skippedVolume} sports=${skippedSports}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ Poll failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Startup self-test
// ---------------------------------------------------------------------------

function withTimeout<T>(thenable: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function selfTest(): Promise<void> {
  console.log("\n🧪 SELF-TEST: Verifying pipeline...\n");

  // 1. Supabase write
  console.log("  1️⃣  Testing Supabase write...");
  try {
    const wr = await withTimeout(
      supabase.from("signals").insert({
        market_id: null,
        strategy: "self_test",
        claude_vote: "NO_TRADE",
        consensus: "NO_TRADE",
        confidence: 0,
        ai_probability: 0.5,
        market_price: 0.5,
        price_gap: 0,
        reasoning: "Self-test — safe to delete",
        acted_on: false,
      }) as PromiseLike<{ error: { message: string } | null }>,
      10_000,
      "Supabase INSERT"
    );
    if (wr.error) {
      console.error("  ❌ Supabase INSERT failed:", wr.error.message);
      return;
    }
    console.log("  ✅ Supabase write OK");
  } catch (err) {
    console.error("  ❌ Supabase write error:", err instanceof Error ? err.message : String(err));
    return;
  }

  // 2. Supabase read + cleanup
  console.log("  2️⃣  Testing Supabase read...");
  try {
    const rd = await withTimeout(
      supabase.from("signals").select("id").eq("strategy", "self_test")
        .order("created_at", { ascending: false }).limit(1) as PromiseLike<{ data: any[] | null; error: { message: string } | null }>,
      10_000,
      "Supabase SELECT"
    );
    if (rd.error || !rd.data?.length) {
      console.error("  ❌ Read failed");
      return;
    }
    console.log("  ✅ Supabase read OK");
    await supabase.from("signals").delete().eq("id", rd.data[0].id);
  } catch (err) {
    console.error("  ❌ Read error:", err instanceof Error ? err.message : String(err));
  }

  // 3. Claude API
  if (anthropic) {
    console.log("  3️⃣  Testing Claude API...");
    try {
      const res = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 32,
        messages: [{ role: "user", content: "Reply with only: OK" }],
        temperature: 0,
      });
      const text = res.content[0]?.type === "text" ? res.content[0].text : "";
      console.log(`  ✅ Claude API OK ("${text.trim()}")`);
    } catch (err) {
      console.error("  ❌ Claude API failed:", err instanceof Error ? err.message : String(err));
      return;
    }
  }

  // 4. Kalshi API
  console.log("  4️⃣  Testing Kalshi API...");
  try {
    const bal = await kalshiFetch<{ balance: number }>("GET", "/portfolio/balance");
    console.log(`  ✅ Kalshi API OK (balance: $${(bal.balance / 100).toFixed(2)})`);
  } catch (err) {
    console.error("  ❌ Kalshi API failed:", err instanceof Error ? err.message : String(err));
    console.error("  ⚠️  Feed will still run but market data may fail");
  }

  // 5. Kill switch
  console.log("  5️⃣  Checking kill switch...");
  const killed = await checkKillSwitch();
  console.log(killed ? "  🔴 Kill switch ACTIVE" : "  ✅ Kill switch OFF");

  // 6. Telegram (only once — guard against re-invocation)
  if (!kalshiAlertSent) {
    const tgOk = await sendTelegramMessage("*PolyBot Kalshi Feed Started*\nSelf-test passed. Polling every 30s.");
    console.log(tgOk ? "  6️⃣  ✅ Telegram sent" : "  6️⃣  ⏭️  Telegram skipped");
    kalshiAlertSent = true;
  } else {
    console.log("  6️⃣  ⏭️  Telegram startup already sent — skipped");
  }

  console.log(`\n🧪 SELF-TEST COMPLETE ✅\n`);
}

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

setInterval(printStats, 60_000);
setInterval(checkKillSwitch, 60_000);
setInterval(checkAutoKillSwitch, 300_000);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log("═══════════════════════════════════════");
console.log("  PolyBot Feed — Kalshi → Supabase");
console.log(`  Polling every ${POLL_INTERVAL_MS / 1000}s`);
console.log("═══════════════════════════════════════");

selfTest()
  .then(async () => {
    // First poll immediately
    await pollKalshi();
    // Then poll on interval
    setInterval(pollKalshi, POLL_INTERVAL_MS);
    console.log(`\n👀 Watching Kalshi markets every ${POLL_INTERVAL_MS / 1000}s...\n`);
  })
  .catch((err) => {
    console.error("❌ Self-test crashed:", err);
    console.log("Starting feed anyway...\n");
    setInterval(pollKalshi, POLL_INTERVAL_MS);
  });
