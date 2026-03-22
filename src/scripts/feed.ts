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
const MAX_POSITIONS = 8;       // Max simultaneous open positions
const MIN_BALANCE_FLOOR = 5.00; // Never trade below this balance ($)
const MAX_TRADE_DOLLARS = 1.25; // Max cost per single trade ($)
const TAKE_PROFIT_PCT = 25;    // Sell when position is up 25%+

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
// Auto-exec — place Kalshi order directly from feed.ts
// Uses the existing kalshiFetch (Node.js native crypto) already in this file.
// ---------------------------------------------------------------------------

async function autoExecTrade(
  kalshiTicker: string,
  side: "yes" | "no",
  marketId: string,
  strategy: string,
  confidence: number,
  yesPrice: number
): Promise<void> {
  try {
    // Paper mode gate
    if (PAPER_MODE) {
      const priceCents = Math.round(yesPrice * 100);
      console.log(`  📝 PAPER: would have bought ${kalshiTicker} ${side.toUpperCase()} @ ${priceCents}c`);
      return;
    }

    // Safety Check 1 — Max positions cap
    try {
      const posData = await kalshiFetch<{ market_positions: unknown[] }>(
        "GET",
        "/portfolio/positions?settlement_status=unsettled"
      );
      const posCount = (posData.market_positions ?? []).length;
      if (posCount >= MAX_POSITIONS) {
        console.log(`  🚫 SKIP AUTO-EXEC: max positions reached (${posCount}/${MAX_POSITIONS})`);
        return;
      }
    } catch (posErr) {
      console.warn(`  ⚠️  Positions check failed (continuing): ${posErr instanceof Error ? posErr.message : String(posErr)}`);
    }

    // Safety Check 2 — Balance floor
    try {
      const balData = await kalshiFetch<{ balance: number }>("GET", "/portfolio/balance");
      const balanceDollars = balData.balance / 100; // Kalshi returns cents
      if (balanceDollars < MIN_BALANCE_FLOOR) {
        console.log(`  🚫 SKIP AUTO-EXEC: balance too low ($${balanceDollars.toFixed(2)} < $${MIN_BALANCE_FLOOR} floor)`);
        return;
      }
    } catch (balErr) {
      console.warn(`  ⚠️  Balance check failed (continuing): ${balErr instanceof Error ? balErr.message : String(balErr)}`);
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

    // Safety Check 3 — Max trade cost
    const tradeCostDollars = priceCents / 100;
    if (tradeCostDollars > MAX_TRADE_DOLLARS) {
      console.log(`  🚫 SKIP AUTO-EXEC: trade cost $${tradeCostDollars.toFixed(2)} exceeds $${MAX_TRADE_DOLLARS} max`);
      return;
    }

    // Sanity: price must be 1-99 cents
    if (priceCents < 1 || priceCents > 99) {
      console.error(`  ❌ AUTO-EXEC FAILED: ${kalshiTicker} invalid price ${priceCents}c`);
      return;
    }

    const count = 1; // 1 contract = ~$0.01-$0.99 max risk

    const body = {
      ticker: kalshiTicker,
      action: "buy",
      side,
      count,
      type: "limit",
      ...(side === "yes" ? { yes_price: priceCents } : { no_price: priceCents }),
    };

    console.log(`  🤖 AUTO-EXEC: placing ${side.toUpperCase()} on ${kalshiTicker} @ ${priceCents}c...`);

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

    console.log(`  ✅ AUTO-EXEC: ${kalshiTicker} ${side.toUpperCase()} @ ${priceCents}c | order ${orderId}`);

    // Save trade to Supabase
    const { error: tradeErr } = await supabase.from("trades").insert({
      market_id: marketId,
      direction: side,
      entry_price: yesPrice,
      shares: count,
      entry_cost: priceCents / 100,
      strategy: strategy ?? "unknown",
      status: "open",
      notes: `AUTO-EXEC: ${orderId} | ${kalshiTicker} | conf:${confidence}%`,
    });
    if (tradeErr) {
      console.error(`  ⚠️  Trade save failed: ${tradeErr.message}`);
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
          console.log(`  ⚠️  TAKE-PROFIT: ${ticker} — no open trade in Supabase, skipping`);
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

        if (gainPct < TAKE_PROFIT_PCT) {
          console.log(`  📊 HOLD: ${ticker} ${side.toUpperCase()} entry=${(entryCostDollars * 100).toFixed(0)}c current=${currentBidCents}c gain=${gainPct.toFixed(1)}% (threshold: ${TAKE_PROFIT_PCT}%)`);
          continue;
        }

        // Take profit — place sell order at current bid
        console.log(`  💰 TAKE PROFIT: ${ticker} ${side.toUpperCase()} entry=${(entryCostDollars * 100).toFixed(0)}c current=${currentBidCents}c gain=${gainPct.toFixed(1)}% — SELLING`);

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
          console.error(`  ❌ TAKE-PROFIT SELL FAILED: ${ticker} no order_id in response`);
          continue;
        }

        console.log(`  ✅ SOLD: ${ticker} ${side.toUpperCase()} @ ${currentBidCents}c | order ${orderId} | +${gainPct.toFixed(1)}%`);

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
              notes: `TAKE-PROFIT: ${orderId} | +${gainPct.toFixed(1)}%`,
            })
            .eq("id", tradeRow.id);
        } catch {
          console.error(`  ⚠️  Trade update failed for ${ticker}`);
        }

        // Telegram alert
        sendTelegramMessage(
          `*💰 PROFIT TAKEN*\n\nTicker: ${ticker}\nSide: ${side.toUpperCase()}\nEntry: ${(entryCostDollars * 100).toFixed(0)}c\nExit: ${currentBidCents}c\nGain: +${gainPct.toFixed(1)}%\nP&L: +$${pnl.toFixed(2)}`
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
  confThreshold: number = MIN_CONFIDENCE
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
Volume: $${volume.toLocaleString()}${btcPrice ? `\nCurrent BTC price: $${btcPrice}` : ""}

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
      await autoExecTrade(kalshiTicker, side, marketId, strategy, confidence, yesPrice);

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
      if (positions.length > 0) {
        lines.push("YOUR OPEN POSITIONS (do NOT re-enter these markets):");
        for (const p of positions.slice(0, 5)) {
          const side = parseFloat(String(p.position_fp)) < 0 ? "NO" : "YES";
          const exposure = parseFloat(String(p.market_exposure_dollars ?? "0")).toFixed(2);
          lines.push(`- ${side} on ${p.ticker} — $${exposure} exposure`);
        }
      }
    } catch (posErr) {
      console.log(`  ⚠️  Memory: positions fetch failed (continuing): ${posErr instanceof Error ? posErr.message : String(posErr)}`);
    }

    // Layer 2 — Recent losses from Supabase trades
    try {
      const { data: losses } = await supabase
        .from("trades")
        .select("market_title, strategy, confidence, pnl")
        .lt("pnl", 0)
        .order("created_at", { ascending: false })
        .limit(5);
      if (losses && losses.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("RECENT LOSSES (be more cautious on similar markets):");
        for (const t of losses) {
          const title = (t.market_title ?? "unknown").slice(0, 50);
          lines.push(`- Lost $${Math.abs(t.pnl).toFixed(2)} on "${title}", strategy: ${t.strategy ?? "unknown"}, conf: ${t.confidence ?? "?"}%`);
        }
      }
    } catch {
      // Silent — no trades table or no losses is fine
    }

    // Layer 3 — Winning patterns from Supabase trades
    try {
      const { data: wins } = await supabase
        .from("trades")
        .select("market_title, strategy, confidence, pnl")
        .gt("pnl", 0)
        .order("created_at", { ascending: false })
        .limit(5);
      if (wins && wins.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("WINNING PATTERNS (prioritize similar setups):");
        for (const t of wins) {
          const title = (t.market_title ?? "unknown").slice(0, 50);
          lines.push(`- Won $${t.pnl.toFixed(2)} on "${title}", strategy: ${t.strategy ?? "unknown"}, conf: ${t.confidence ?? "?"}%`);
        }
      }
    } catch {
      // Silent — no wins is fine
    }
  } catch {
    // Total failure — return empty, don't break the feed
  }

  if (lines.length === 0) return "";
  return `\n--- PORTFOLIO MEMORY (do NOT ignore) ---\n${lines.join("\n")}\n--- END PORTFOLIO MEMORY ---\n`;
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

    // Check open positions for take-profit opportunities (before new analysis)
    await checkAndSellPositions();

    // Build memory context once per poll cycle (positions + trade history)
    const memoryContext = await buildMemoryContext();
    if (memoryContext) {
      console.log(`  🧠 Memory context loaded (${memoryContext.split("\n").length - 2} lines)`);
    }

    // Fetch multiple categories — priority series first, then general
    const endpoints = [
      "/events?status=open&with_nested_markets=true&limit=200&series_ticker=KXBTC&sort_by=close_time&sort_direction=asc",
      "/events?status=open&with_nested_markets=true&limit=200&series_ticker=KXFED&sort_by=close_time&sort_direction=asc",
      "/events?status=open&with_nested_markets=true&limit=200&sort_by=close_time&sort_direction=asc",
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

      // Tiered expiry filter — getDynamicConfidenceThreshold returns null for SKIP
      const confThreshold = getDynamicConfidenceThreshold(daysLeft);
      if (confThreshold === null) {
        if (daysLeft > MAX_EXPIRY_DAYS) {
          console.log(`  ⏰ SKIP: ${m.ticker} expires in ${daysLeft} days (>180 day cap)`);
        }
        skippedExpiry++;
        totalFiltered++;
        continue;
      }
      console.log(`  📅 ${m.ticker} daysLeft=${daysLeft} confThreshold=${confThreshold}%`);

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

      // Volume filter — skip illiquid markets (500+ for quality signals)
      const vol24h = (m.volume_24h_fp ?? m.volume_24h ?? m.volume ?? 0) as number;
      if (vol24h < 500) {
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

      // BTC price range filter — no live price data to assess these
      const titleLower = m.title.toLowerCase();
      if (
        (m.ticker.startsWith("KXBTC-") && titleLower.includes("price range")) ||
        titleLower.includes("bitcoin price range")
      ) {
        console.log(`  ⚡ SKIP: ${m.ticker} BTC price range market (no live price data)`);
        totalFiltered++;
        continue;
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
        confThreshold
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
