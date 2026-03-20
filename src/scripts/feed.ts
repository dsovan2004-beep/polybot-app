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
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  volume_24h?: number;
  event_ticker?: string;
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

async function saveMarket(m: KalshiMarketFromAPI): Promise<string | null> {
  const yesPrice = m.yes_bid > 0 ? m.yes_bid / 100 : 0.5;
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

const SIGNAL_SYSTEM_PROMPT = `You are a prediction market analyst for PolyBot. Analyze this Kalshi market. Output ONLY valid JSON:
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

const analyzedMarkets = new Set<string>();

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
  volume: number
): Promise<void> {
  if (killSwitchActive || !anthropic) return;
  if (analyzedMarkets.has(kalshiTicker)) return;

  analyzedMarkets.add(kalshiTicker);
  console.log(`  🔄 Claude → ${title.slice(0, 60)}...`);

  try {
    const userPrompt = `Market: ${title}
Kalshi Ticker: ${kalshiTicker}
Category: ${category}
Current YES price: ${yesPrice.toFixed(2)} (implied probability: ${(yesPrice * 100).toFixed(1)}%)
Volume: $${volume.toLocaleString()}

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
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("  ⚠️  No JSON in Claude response");
      return;
    }

    const parsed: ClaudeSignal = JSON.parse(jsonMatch[0]);
    const vote = String(parsed.vote).toUpperCase();
    if (!["YES", "NO", "NO_TRADE"].includes(vote)) return;

    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence))));
    const probability = Math.max(0, Math.min(1, Number(parsed.probability)));
    const priceGap = Math.abs(probability - yesPrice);

    const finalVote =
      confidence < MIN_CONFIDENCE || priceGap < MIN_PRICE_GAP ? "NO_TRADE" : vote;

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

    // Telegram alert for actionable signals
    if (finalVote !== "NO_TRADE" && confidence >= MIN_CONFIDENCE && priceGap >= MIN_PRICE_GAP) {
      const alertMsg = [
        `*PolyBot Signal*`,
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
// Kalshi polling loop
// ---------------------------------------------------------------------------

async function pollKalshi(): Promise<void> {
  totalPolled++;
  console.log(`\n🔄 Poll #${totalPolled} — fetching Kalshi events...`);

  try {
    const data = await kalshiFetch<{
      events: KalshiEvent[];
      markets?: KalshiMarketFromAPI[];
    }>("GET", "/events?status=open&with_nested_markets=true&limit=200");

    // Collect all markets from events
    let allMarkets: KalshiMarketFromAPI[] = [];
    if (data.markets && data.markets.length > 0) {
      allMarkets = data.markets;
    } else if (data.events) {
      for (const evt of data.events) {
        if (evt.markets) allMarkets.push(...evt.markets);
      }
    }

    totalMarketsFound = allMarkets.length;
    console.log(`  📦 ${allMarkets.length} markets from ${data.events?.length ?? 0} events`);

    // Debug: log first market to see actual API shape
    if (allMarkets.length > 0) {
      const sample = allMarkets[0];
      console.log(`  🔍 Sample market keys: ${Object.keys(sample).join(", ")}`);
      console.log(`  🔍 Sample: ticker=${sample.ticker} status=${sample.status} yes_bid=${sample.yes_bid} yes_ask=${sample.yes_ask} title=${sample.title?.slice(0, 40)}`);
    }

    let processed = 0;
    let skippedStatus = 0;
    let skippedPrice = 0;
    let skippedSports = 0;
    for (const m of allMarkets) {
      if (m.status !== "open") { skippedStatus++; continue; }

      // Price filter — use yes_ask as fallback if yes_bid is 0
      const rawPrice = m.yes_bid > 0 ? m.yes_bid : m.yes_ask > 0 ? m.yes_ask : 0;
      const yesPrice = rawPrice > 0 ? rawPrice / 100 : 0;
      if (yesPrice < PRICE_MIN || yesPrice > PRICE_MAX) {
        skippedPrice++;
        totalFiltered++;
        continue;
      }

      // Sports filter — skip sports markets entirely
      if (isSports(m.title)) {
        skippedSports++;
        totalFiltered++;
        continue;
      }

      // Categorize for labeling (not filtering — let Claude decide)
      const category = categorize(m.title);

      // Save market to Supabase (with kalshi_ticker)
      const marketId = await saveMarket(m);
      if (!marketId) continue;
      totalSaved++;
      processed++;

      console.log(
        `  📈 ${m.ticker} | ${(yesPrice * 100).toFixed(0)}c | [${category}] ${m.title.slice(0, 55)}`
      );

      // Analyze with Claude
      await analyzeMarket(
        marketId,
        m.ticker,
        m.title,
        category,
        yesPrice,
        m.volume_24h ?? m.volume ?? 0
      );
    }

    console.log(`  ✅ Processed ${processed} | skipped: status=${skippedStatus} price=${skippedPrice} sports=${skippedSports}`);
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

  // 6. Telegram
  const tgOk = await sendTelegramMessage("*PolyBot Kalshi Feed Started*\nSelf-test passed. Polling every 30s.");
  console.log(tgOk ? "  6️⃣  ✅ Telegram sent" : "  6️⃣  ⏭️  Telegram skipped");

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
