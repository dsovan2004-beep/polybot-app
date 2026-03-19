#!/usr/bin/env npx ts-node
// ============================================================================
// PolyBot — Standalone Polymarket Feed Script
// Runs on your Mac, connects to Polymarket WebSocket, saves to Supabase
// Usage: npx ts-node src/scripts/feed.ts
// Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local from project root
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const POLYMARKET_WS = "wss://ws-live-data.polymarket.com";
const MIN_USD = 10;
const PRICE_MIN = 0.02;
const PRICE_MAX = 0.98;

const SPORTS_KEYWORDS = [
  "nba", "nfl", "ufc", "football", "basketball", "soccer",
  "mlb", "nhl", "tennis", "boxing", "mma", "premier league",
  "champions league", "world cup", "super bowl", "playoff",
  "grand slam", "olympics",
];

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

let totalReceived = 0;
let totalFiltered = 0;
let totalSaved = 0;
let totalWhales = 0;
let startTime = Date.now();

function printStats() {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const mins = Math.floor(uptime / 60);
  const secs = uptime % 60;
  console.log(
    `\n📊 Stats — uptime ${mins}m${secs}s | received: ${totalReceived} | filtered: ${totalFiltered} | saved: ${totalSaved} | whales: ${totalWhales}\n`
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

async function saveMarket(trade: {
  conditionId: string;
  title: string;
  price: number;
  usdAmount: number;
}): Promise<string | null> {
  const { data, error } = await supabase
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
    .select("id")
    .single();

  if (error) {
    console.error("  ❌ Market save failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

async function saveWhale(
  marketId: string,
  side: string,
  size: number,
  price: number
): Promise<void> {
  const { error } = await supabase.from("whale_activity").insert({
    market_id: marketId,
    wallet_address: "polymarket-ws",
    direction: side.toLowerCase(),
    trade_size_usd: size,
    price_at_trade: price,
  });

  if (error) {
    console.error("  ❌ Whale save failed:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Parse trade message
// ---------------------------------------------------------------------------

interface ParsedTrade {
  conditionId: string;
  title: string;
  outcome: string;
  price: number;
  size: number;
  usdAmount: number;
}

function parseTrade(raw: string): ParsedTrade | null {
  try {
    const msg = JSON.parse(raw);

    // Real format: { connection_id, payload: { asset, conditionId, eventSlug, ... } }
    const p = msg.payload ?? msg;

    // Try multiple field locations
    const conditionId = p.conditionId ?? p.condition_id ?? p.asset_id ?? p.market ?? "";
    const eventSlug = p.eventSlug ?? p.event_slug ?? "";
    const title = p.question ?? p.title ?? p.market_slug ?? eventSlug ?? conditionId;
    const outcome = p.outcome ?? p.side ?? p.type ?? "unknown";
    const price = parseFloat(p.price ?? p.last_price ?? p.avgPrice ?? "0");
    const size = parseFloat(p.size ?? p.amount ?? p.matchedAmount ?? "0");

    // Also check for nested trade data
    const tradePrice = price || parseFloat(p.tradePrice ?? "0");
    const tradeSize = size || parseFloat(p.tradeAmount ?? "0");

    if (!conditionId && !eventSlug) return null;
    if (isNaN(tradePrice) || tradePrice === 0) return null;

    // If size is 0, this might be a market update not a trade — still track it
    const finalSize = tradeSize > 0 ? tradeSize : 1;

    return {
      conditionId: conditionId || eventSlug,
      title: title || eventSlug,
      outcome,
      price: tradePrice,
      size: finalSize,
      usdAmount: tradePrice * finalSize,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Process a single trade
// ---------------------------------------------------------------------------

async function processTrade(trade: ParsedTrade): Promise<void> {
  totalReceived++;

  // Filter: USD amount
  if (trade.usdAmount < MIN_USD) {
    totalFiltered++;
    return;
  }

  // Filter: price range (skip near-resolution)
  if (trade.price < PRICE_MIN || trade.price > PRICE_MAX) {
    totalFiltered++;
    return;
  }

  // Filter: sports
  if (isSports(trade.title)) {
    totalFiltered++;
    return;
  }

  // Log the trade
  const side = trade.outcome.toUpperCase();
  const category = categorize(trade.title);
  console.log(
    `🔵 TRADE | $${trade.usdAmount.toFixed(0)} | ${side} @ ${trade.price.toFixed(3)} | [${category}] ${trade.title.slice(0, 60)}`
  );

  // Save to markets
  const marketId = await saveMarket(trade);
  if (!marketId) return;
  totalSaved++;

  // Save whale activity (all trades >= $500 that pass filters)
  await saveWhale(marketId, trade.outcome, trade.usdAmount, trade.price);
  totalWhales++;

  console.log(`  ✅ Saved to Supabase (market: ${marketId.slice(0, 8)}...)`);
}

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

function connect(): void {
  console.log("\n🔌 Connecting to Polymarket WebSocket...");
  console.log(`   URL: ${POLYMARKET_WS}`);
  console.log(`   Supabase: ${SUPABASE_URL}`);
  console.log(`   Min USD: $${MIN_USD}`);
  console.log(`   Price range: ${PRICE_MIN}–${PRICE_MAX}`);
  console.log(`   Sports filter: ON\n`);

  const ws = new WebSocket(POLYMARKET_WS);

  ws.on("open", () => {
    console.log("✅ Connected to Polymarket WebSocket\n");
    startTime = Date.now();

    // Try multiple subscription formats to find what works
    const sub1 = {
      action: "subscribe",
      subscriptions: [
        { topic: "activity", type: "trades" },
        { topic: "activity", type: "*" },
      ],
    };
    ws.send(JSON.stringify(sub1));
    console.log("📡 Sent subscription format 1 (action + topic/type)");

    // Also try the simpler format
    const sub2 = {
      type: "subscribe",
      channel: "market_data",
    };
    ws.send(JSON.stringify(sub2));
    console.log("📡 Sent subscription format 2 (type/channel)");

    console.log("👀 Watching for trades >= $" + MIN_USD + "...\n");
  });

  ws.on("message", (data: WebSocket.Data) => {
    const raw = data.toString();

    // Debug: log first 10 raw messages to see format
    if (totalReceived < 10) {
      console.log(`📩 RAW MSG #${totalReceived + 1}:`, raw.slice(0, 500));
    }

    const trade = parseTrade(raw);
    if (trade) {
      processTrade(trade).catch((err) =>
        console.error("  ❌ processTrade error:", err)
      );
    } else {
      // Count messages that don't parse as trades
      totalReceived++;
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    console.log(`\n🔌 Disconnected (code: ${code}, reason: ${reason.toString()})`);
    printStats();

    if (code !== 1000) {
      console.log("⏳ Reconnecting in 5 seconds...\n");
      setTimeout(connect, 5_000);
    }
  });

  ws.on("error", (err: Error) => {
    console.error("❌ WebSocket error:", err.message);
  });
}

// ---------------------------------------------------------------------------
// Stats printer (every 60 seconds)
// ---------------------------------------------------------------------------

setInterval(printStats, 60_000);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log("═══════════════════════════════════════");
console.log("  PolyBot Feed — Polymarket → Supabase");
console.log("═══════════════════════════════════════");

connect();
