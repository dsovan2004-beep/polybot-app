#!/usr/bin/env npx ts-node
// ============================================================================
// PolyBot — Standalone Polymarket Feed Script
// Runs on your Mac, connects to Polymarket WebSocket, saves to Supabase
// Usage: npx ts-node src/scripts/feed.ts
// Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import WebSocket from "ws";
import * as dotenv from "dotenv";
import * as path from "path";

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

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("✅ Using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)");
} else {
  console.warn("⚠️  Using anon key — RLS may block signal writes. Add SUPABASE_SERVICE_ROLE_KEY to .env.local");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY not found in .env.local — Claude analysis disabled");
  console.warn("   Add ANTHROPIC_API_KEY=sk-ant-... to your .env.local file");
} else {
  console.log(`✅ ANTHROPIC_API_KEY loaded (${ANTHROPIC_API_KEY.slice(0, 12)}...)`);
}
const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 15_000 })
  : null;

const POLYMARKET_WS = "wss://ws-live-data.polymarket.com";
const MIN_USD = 10;
const PRICE_MIN = 0.02;
const PRICE_MAX = 0.98;

const SPORTS_KEYWORDS = [
  "nba", "nfl", "ufc", "football", "basketball", "soccer",
  "mlb", "nhl", "tennis", "boxing", "mma", "premier league",
  "champions league", "world cup", "super bowl", "playoff",
  "grand slam", "olympics",
  // Sprint 5 — strengthened sports filter
  "fc", "vs.", "o/u", "open", "uefa", "premier",
  "laliga", "bundesliga", "serie a", "ligue 1", "mls",
  "vallecano", "porto", "stuttgart", "samsunspor",
  "forest", "madrid", "tagger", "seidel",
  // Sprint 5b — more sports/betting keywords
  "spread:", "commodores", "bulldogs",
  "ncaa", "spread", "covers", "ats",
  // Sprint 5c — additional sports
  "masters", "world series", "astros",
  "yankees", "dodgers", "tournament",
  "pga", "golf", "baseball",
  "stanley cup", "championship",
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
    `\n📊 Stats — uptime ${mins}m${secs}s | received: ${totalReceived} | filtered: ${totalFiltered} | saved: ${totalSaved} | whales: ${totalWhales} | signals: ${totalSignals}\n`
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
// Claude AI Signal — inline analysis (bypasses Cloudflare timeout)
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const MIN_CONFIDENCE = 67;
const MIN_PRICE_GAP = 0.10;

const SIGNAL_SYSTEM_PROMPT = `You are a prediction market analyst for PolyBot, an AI-powered Polymarket trading tool. You analyze markets using probability theory, news sentiment, and risk assessment. You are calibrated, data-driven, and skeptical of narratives.

Analyze this market. Output ONLY valid JSON:
{
  "vote": "YES" or "NO" or "NO_TRADE",
  "probability": 0.00 to 1.00,
  "confidence": 0 to 100,
  "reason": "one sentence max",
  "strategy": "news_lag" or "sentiment_fade" or "logical_arb" or "maker" or "unknown"
}

Rules:
- Only vote YES or NO if your confidence is >= 67
- Only vote YES or NO if the price gap is >= 10% (abs(your probability - market price) > 0.10)
- Otherwise vote NO_TRADE
- Be calibrated — don't be overconfident
- Consider base rates, recent news, and market efficiency`;

// Track which markets we've already analyzed (avoid duplicate Claude calls)
const analyzedMarkets = new Set<string>();
let totalSignals = 0;

interface ClaudeSignal {
  vote: "YES" | "NO" | "NO_TRADE";
  probability: number;
  confidence: number;
  reason: string;
  strategy: string;
}

async function analyzeMarket(
  marketId: string,
  title: string,
  category: string,
  price: number,
  volume: number
): Promise<void> {
  // Debug: log every call so we can see what's happening
  console.log(`  🧠 analyzeMarket called | id=${marketId.slice(0, 8)} | cat=${category} | claude=${anthropic ? "ON" : "OFF"}`);

  if (!anthropic) {
    console.log("  ⏭️  Skipped: no ANTHROPIC_API_KEY");
    return;
  }
  if (analyzedMarkets.has(marketId)) {
    console.log("  ⏭️  Skipped: already analyzed");
    return;
  }

  analyzedMarkets.add(marketId);
  console.log(`  🔄 Calling Claude for: ${title.slice(0, 50)}...`);

  try {
    const userPrompt = `Market: ${title}
Category: ${category}
Current YES price: ${price} (implied probability: ${(price * 100).toFixed(1)}%)
24h Volume: $${volume.toLocaleString()}

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
    console.log(`  ⏱️  Claude responded in ${claudeMs}ms`);

    const content = res.content[0]?.type === "text" ? res.content[0].text : "";
    console.log(`  📝 Claude raw response: ${content.slice(0, 120)}...`);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("  ⚠️  No JSON in Claude response");
      return;
    }

    const parsed: ClaudeSignal = JSON.parse(jsonMatch[0]);

    // Normalize vote
    const vote = String(parsed.vote).toUpperCase();
    if (!["YES", "NO", "NO_TRADE"].includes(vote)) {
      console.error(`  ⚠️  Invalid vote from Claude: ${parsed.vote}`);
      return;
    }

    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence))));
    const probability = Math.max(0, Math.min(1, Number(parsed.probability)));
    const priceGap = Math.abs(probability - price);

    // Apply rules: 67% confidence and 10% price gap
    const finalVote =
      confidence < MIN_CONFIDENCE || priceGap < MIN_PRICE_GAP ? "NO_TRADE" : vote;

    const validStrategies = ["news_lag", "sentiment_fade", "logical_arb", "maker", "unknown"];
    const strategy = validStrategies.includes(parsed.strategy) ? parsed.strategy : "unknown";

    // Save signal to Supabase signals table
    const signalPayload = {
      market_id: marketId,
      strategy,
      claude_vote: finalVote,
      gpt4o_vote: null,
      gemini_vote: null,
      consensus: finalVote,
      confidence,
      ai_probability: probability,
      market_price: price,
      price_gap: priceGap,
      reasoning: String(parsed.reason ?? ""),
      acted_on: false,
    };
    console.log(`  💾 Saving signal: ${finalVote} | conf=${confidence} | gap=${(priceGap * 100).toFixed(1)}%`);

    const { data: savedSignal, error } = await supabase
      .from("signals")
      .insert(signalPayload)
      .select("id")
      .single();

    if (error) {
      console.error("  ❌ Signal save failed:", error.message);
      console.error("  ❌ Payload:", JSON.stringify(signalPayload));
      return;
    }
    console.log(`  💾 Signal saved to Supabase (id: ${savedSignal?.id?.slice(0, 8)}...)`);

    totalSignals++;
    const voteColor = finalVote === "YES" ? "🟢" : finalVote === "NO" ? "🔴" : "⚪";
    console.log(
      `  ${voteColor} SIGNAL: ${finalVote} | conf ${confidence}% | gap ${(priceGap * 100).toFixed(1)}% | ${parsed.reason?.slice(0, 50)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ⚠️  Claude analysis failed: ${msg}`);
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

  // Analyze with Claude (runs inline — no Cloudflare timeout)
  await analyzeMarket(marketId, trade.title, category, trade.price, trade.usdAmount);
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
  console.log(`   Sports filter: ON`);
  console.log(`   Claude analysis: ${anthropic ? "ON" : "OFF (no ANTHROPIC_API_KEY)"}\n`);

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

// ---------------------------------------------------------------------------
// Startup self-test: verify Claude + Supabase pipeline works end-to-end
// ---------------------------------------------------------------------------

async function selfTest(): Promise<void> {
  console.log("\n🧪 SELF-TEST: Verifying full signal pipeline...\n");

  // Step 1: Test Supabase write
  console.log("  1️⃣  Testing Supabase write...");
  const testId = "00000000-0000-0000-0000-000000000000";
  const { error: writeErr } = await supabase.from("signals").insert({
    market_id: null,
    strategy: "self_test",
    claude_vote: "NO_TRADE",
    gpt4o_vote: null,
    gemini_vote: null,
    consensus: "NO_TRADE",
    confidence: 0,
    ai_probability: 0.5,
    market_price: 0.5,
    price_gap: 0,
    reasoning: "Self-test signal — safe to delete",
    acted_on: false,
  });
  if (writeErr) {
    console.error("  ❌ Supabase INSERT failed:", writeErr.message);
    console.error("  ⚠️  Check RLS policies on signals table — anon role needs INSERT permission");
    console.error("  ⚠️  Signals will NOT be saved. Fix this before continuing.\n");
    return;
  }
  console.log("  ✅ Supabase write OK");

  // Step 2: Test Supabase read
  console.log("  2️⃣  Testing Supabase read...");
  const { data: readData, error: readErr } = await supabase
    .from("signals")
    .select("id, strategy")
    .eq("strategy", "self_test")
    .order("created_at", { ascending: false })
    .limit(1);
  if (readErr) {
    console.error("  ❌ Supabase SELECT failed:", readErr.message);
    return;
  }
  if (!readData || readData.length === 0) {
    console.error("  ❌ Write succeeded but read returned 0 rows — check RLS SELECT policy");
    return;
  }
  console.log("  ✅ Supabase read OK (signal id:", readData[0].id.slice(0, 8) + "...)");

  // Clean up test signal
  await supabase.from("signals").delete().eq("id", readData[0].id);

  // Step 3: Test Claude API (quick, cheap call)
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
      console.log(`  ✅ Claude API OK (response: "${text.trim()}")`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("  ❌ Claude API failed:", msg);
      console.error("  ⚠️  Check ANTHROPIC_API_KEY and credit balance");
      console.error("  ⚠️  Claude analysis will NOT work. Fix this before continuing.\n");
      return;
    }
  } else {
    console.log("  ⏭️  Claude test skipped (no ANTHROPIC_API_KEY)");
  }

  // Step 4: Count existing signals
  const { data: countData } = await supabase
    .from("signals")
    .select("id", { count: "exact", head: true });
  const existingCount = countData?.length ?? 0;

  console.log(`\n🧪 SELF-TEST PASSED ✅ — Pipeline is healthy`);
  console.log(`   Existing signals in Supabase: ${existingCount}`);
  console.log("");
}

// Run self-test, then start the feed
selfTest()
  .then(() => connect())
  .catch((err) => {
    console.error("❌ Self-test crashed:", err);
    console.log("Starting feed anyway...\n");
    connect();
  });
