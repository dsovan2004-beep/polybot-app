// ============================================================================
// PolyBot — BTC 5-Minute Liquidation + MACD Strategy (Sprint 6)
// Layer 1: Binance forced liquidation WebSocket feed
// Layer 2: MACD crossover signal (MoonDev ML research validation)
// Combined: Claude + MACD agreement = 0.85 confidence (best edge)
// Kalshi API: order placement (paper → live gate)
// Telegram: real-time alerts on high-confidence signals
// MAKER orders only — includes feeRateBps in all order signatures
// ============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BINANCE_LIQUIDATION_WS =
  "wss://fstream.binance.com/ws/!forceOrder@arr";

const SYMBOL_FILTER = "BTCUSDT";
const ROLLING_WINDOW_MS = 60_000; // 60 seconds
const WINDOW_DURATION_SEC = 300; // 5 minutes per Polymarket window
const SIGNAL_THRESHOLD_USD = 500_000;

/** Confidence tiers based on liquidation size. */
const CONFIDENCE_TIERS: { min: number; max: number; confidence: number }[] = [
  { min: 2_000_000, max: Infinity, confidence: 0.85 },
  { min: 1_000_000, max: 2_000_000, confidence: 0.75 },
  { min: 500_000, max: 1_000_000, confidence: 0.65 },
];

// ---------------------------------------------------------------------------
// MACD Constants (MoonDev ML research params)
// ---------------------------------------------------------------------------

const MACD_FAST_PERIOD = 6;
const MACD_SLOW_PERIOD = 26;
const MACD_SIGNAL_PERIOD = 5;
const MACD_HISTOGRAM_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// Combined Signal Constants (MoonDev multi-model validation)
// Multiple signals agreeing = best edge concentration
// ---------------------------------------------------------------------------

const CONFIDENCE_CLAUDE_ONLY = 0.65; // Claude alone (67%+ conf)
const CONFIDENCE_MACD_ONLY = 0.62; // MACD alone (hist > 10)
const CONFIDENCE_COMBINED = 0.85; // Claude + MACD agree
const COMBINED_EXECUTE_THRESHOLD = 0.80; // Only execute above this

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LiquidationEvent {
  symbol: string;
  side: "BUY" | "SELL"; // "SELL" = long liquidation
  price: number;
  quantity: number;
  usdValue: number;
  timestamp: number;
}

interface LiquidationWindow {
  totalUsd: number;
  tradeCount: number;
}

interface MacdResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
  bullish: boolean; // histogram > threshold
  bearish: boolean; // histogram < -threshold
}

interface CombinedSignal {
  claudeActive: boolean;
  claudeConfidence: number;
  macdActive: boolean;
  macdHistogram: number;
  combinedConfidence: number;
  shouldExecute: boolean;
  direction: "UP" | "DOWN" | "NEUTRAL";
  reason: string;
}

export interface Btc5MinSignal {
  slug: string;
  windowTs: number;
  closeTs: number;
  secondsRemaining: number;
  liquidation: {
    totalUsd: number;
    tradeCount: number;
    signalActive: boolean;
    confidence: number;
  };
  macd: MacdResult | null;
  combined: CombinedSignal | null;
}

// ---------------------------------------------------------------------------
// State — rolling window of liquidation events
// ---------------------------------------------------------------------------

let _events: LiquidationEvent[] = [];
let _ws: WebSocket | null = null;
let _cleanupInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// MACD State — rolling price data
// ---------------------------------------------------------------------------

interface PriceCandle {
  price: number;
  timestamp: number;
}

let _priceHistory: PriceCandle[] = [];
const PRICE_HISTORY_MAX = 100; // Keep last 100 price points

/** Add a price point from liquidation events (uses avg liquidation price). */
function recordPrice(price: number): void {
  _priceHistory.push({ price, timestamp: Date.now() });
  if (_priceHistory.length > PRICE_HISTORY_MAX) {
    _priceHistory = _priceHistory.slice(-PRICE_HISTORY_MAX);
  }
}

// ---------------------------------------------------------------------------
// MACD Calculation (pure math, no external deps)
// ---------------------------------------------------------------------------

/** Calculate Exponential Moving Average. */
function calcEma(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/** Calculate full MACD: fast EMA(6), slow EMA(26), signal EMA(5). */
export function calculateMacd(prices: number[]): MacdResult | null {
  if (prices.length < MACD_SLOW_PERIOD + MACD_SIGNAL_PERIOD) return null;

  const fastEma = calcEma(prices, MACD_FAST_PERIOD);
  const slowEma = calcEma(prices, MACD_SLOW_PERIOD);

  // MACD line = fast EMA - slow EMA
  const macdLine: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macdLine.push(fastEma[i] - slowEma[i]);
  }

  // Signal line = EMA of MACD line
  const signalEma = calcEma(macdLine, MACD_SIGNAL_PERIOD);

  // Histogram = MACD - Signal
  const lastIdx = prices.length - 1;
  const macd = macdLine[lastIdx];
  const signal = signalEma[lastIdx];
  const histogram = macd - signal;

  return {
    macdLine: Math.round(macd * 100) / 100,
    signalLine: Math.round(signal * 100) / 100,
    histogram: Math.round(histogram * 100) / 100,
    bullish: histogram > MACD_HISTOGRAM_THRESHOLD,
    bearish: histogram < -MACD_HISTOGRAM_THRESHOLD,
  };
}

/** Get current MACD from price history. */
export function getCurrentMacd(): MacdResult | null {
  if (_priceHistory.length < MACD_SLOW_PERIOD + MACD_SIGNAL_PERIOD) return null;
  const prices = _priceHistory.map((p) => p.price);
  return calculateMacd(prices);
}

// ---------------------------------------------------------------------------
// Combined Signal Logic (MoonDev multi-model validation)
// ---------------------------------------------------------------------------

/**
 * Combine Claude signal + MACD signal.
 * Key insight: multiple models agreeing = where edge concentrates.
 *
 * Claude only (67%+): confidence 0.65
 * MACD only (hist > 10): confidence 0.62
 * Claude + MACD together: confidence 0.85
 * Only execute when combined conf > 0.80
 */
export function getCombinedSignal(
  claudeConf: number,
  claudeVote: "YES" | "NO" | "NO_TRADE" | null,
  macd: MacdResult | null
): CombinedSignal {
  const claudeActive = claudeVote !== null && claudeVote !== "NO_TRADE" && claudeConf >= 67;
  const macdActive = macd !== null && (macd.bullish || macd.bearish);

  // Determine direction from each signal
  const claudeDir = claudeVote === "YES" ? "UP" : claudeVote === "NO" ? "DOWN" : "NEUTRAL";
  const macdDir = macd?.bullish ? "UP" : macd?.bearish ? "DOWN" : "NEUTRAL";

  // Calculate combined confidence
  let combinedConfidence = 0;
  let reason = "";

  if (claudeActive && macdActive) {
    // Both active — check if they agree on direction
    if (claudeDir === macdDir && claudeDir !== "NEUTRAL") {
      combinedConfidence = CONFIDENCE_COMBINED;
      reason = `Claude ${claudeVote} (${claudeConf}%) + MACD ${macdDir} (hist: ${macd!.histogram}) AGREE`;
    } else {
      // Disagreement — use higher individual signal but reduce confidence
      combinedConfidence = Math.max(CONFIDENCE_CLAUDE_ONLY, CONFIDENCE_MACD_ONLY) * 0.9;
      reason = `Signal conflict: Claude=${claudeDir} vs MACD=${macdDir} — reduced confidence`;
    }
  } else if (claudeActive) {
    combinedConfidence = CONFIDENCE_CLAUDE_ONLY;
    reason = `Claude only: ${claudeVote} at ${claudeConf}% (no MACD confirmation)`;
  } else if (macdActive) {
    combinedConfidence = CONFIDENCE_MACD_ONLY;
    reason = `MACD only: ${macdDir} (hist: ${macd!.histogram}) — no Claude confirmation`;
  } else {
    combinedConfidence = 0;
    reason = "No active signals";
  }

  // Resolve final direction
  const direction: "UP" | "DOWN" | "NEUTRAL" =
    combinedConfidence >= COMBINED_EXECUTE_THRESHOLD
      ? (claudeActive ? claudeDir : macdDir) as "UP" | "DOWN" | "NEUTRAL"
      : "NEUTRAL";

  return {
    claudeActive,
    claudeConfidence: claudeConf,
    macdActive,
    macdHistogram: macd?.histogram ?? 0,
    combinedConfidence: Math.round(combinedConfidence * 100) / 100,
    shouldExecute: combinedConfidence >= COMBINED_EXECUTE_THRESHOLD,
    direction,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Slug generation — deterministic 5-minute windows
// ---------------------------------------------------------------------------

/**
 * Get the current BTC 5-min market slug.
 * window_ts = floor(now / 300) * 300
 * slug = `btc-updown-5m-${window_ts}`
 */
export function getCurrentBtc5MinSlug(): string {
  const windowTs = Math.floor(Date.now() / 1000 / WINDOW_DURATION_SEC) * WINDOW_DURATION_SEC;
  return `btc-updown-5m-${windowTs}`;
}

/** Get the current window timestamp (unix seconds). */
export function getCurrentWindowTs(): number {
  return Math.floor(Date.now() / 1000 / WINDOW_DURATION_SEC) * WINDOW_DURATION_SEC;
}

/** Get close time for the current window. */
export function getCloseTs(): number {
  return getCurrentWindowTs() + WINDOW_DURATION_SEC;
}

/** Seconds remaining in current 5-minute window. */
export function getSecondsRemaining(): number {
  return Math.max(0, getCloseTs() - Math.floor(Date.now() / 1000));
}

// ---------------------------------------------------------------------------
// Rolling window management
// ---------------------------------------------------------------------------

/** Prune events older than the rolling window. */
function pruneOldEvents(): void {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  _events = _events.filter((e) => e.timestamp >= cutoff);
}

/** Get the current rolling-window liquidation stats. */
export function getLiquidationWindow(): LiquidationWindow {
  pruneOldEvents();
  const longLiquidations = _events.filter((e) => e.side === "SELL"); // SELL = long liq
  return {
    totalUsd: longLiquidations.reduce((sum, e) => sum + e.usdValue, 0),
    tradeCount: longLiquidations.length,
  };
}

/** Calculate confidence from liquidation total. */
function getConfidence(totalUsd: number): number {
  for (const tier of CONFIDENCE_TIERS) {
    if (totalUsd >= tier.min && totalUsd < tier.max) {
      return tier.confidence;
    }
  }
  return 0;
}

/** Get the full signal state for the API (now includes MACD + combined). */
export function getBtc5MinSignal(): Btc5MinSignal {
  const liq = getLiquidationWindow();
  const signalActive = liq.totalUsd >= SIGNAL_THRESHOLD_USD;
  const confidence = signalActive ? getConfidence(liq.totalUsd) : 0;
  const macd = getCurrentMacd();

  return {
    slug: getCurrentBtc5MinSlug(),
    windowTs: getCurrentWindowTs(),
    closeTs: getCloseTs(),
    secondsRemaining: getSecondsRemaining(),
    liquidation: {
      totalUsd: Math.round(liq.totalUsd),
      tradeCount: liq.tradeCount,
      signalActive,
      confidence,
    },
    macd,
    combined: null, // Populated by caller with Claude signal data
  };
}

// ---------------------------------------------------------------------------
// Binance WebSocket — forced liquidation feed
// ---------------------------------------------------------------------------

/**
 * Parse a Binance forceOrder message.
 * Docs: https://binance-docs.github.io/apidocs/futures/en/#liquidation-order-streams
 * Format: { e: "forceOrder", o: { s, S, p, q, ... } }
 */
function parseLiquidationMessage(raw: string): LiquidationEvent | null {
  try {
    const msg = JSON.parse(raw);
    const order = msg?.o;
    if (!order) return null;

    const symbol: string = order.s ?? "";
    if (symbol !== SYMBOL_FILTER) return null;

    const side: "BUY" | "SELL" = order.S;
    const price = parseFloat(order.p);
    const quantity = parseFloat(order.q);

    if (isNaN(price) || isNaN(quantity)) return null;

    return {
      symbol,
      side,
      price,
      quantity,
      usdValue: price * quantity,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Connect to Binance liquidation WebSocket feed.
 * Filters for BTCUSDT only.
 * Now also tracks price history for MACD calculation.
 * Returns a cleanup function to disconnect.
 */
export function connectBinanceLiquidationFeed(): () => void {
  // Don't double-connect
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    return () => disconnectFeed();
  }

  try {
    _ws = new WebSocket(BINANCE_LIQUIDATION_WS);

    _ws.onopen = () => {
      console.log("[btc5min] Connected to Binance liquidation feed");
    };

    _ws.onmessage = (event: MessageEvent) => {
      const liq = parseLiquidationMessage(
        typeof event.data === "string" ? event.data : ""
      );
      if (liq) {
        _events.push(liq);
        // Record price for MACD calculation
        recordPrice(liq.price);
      }
    };

    _ws.onclose = (event: CloseEvent) => {
      console.log(
        `[btc5min] Disconnected from Binance (code: ${event.code})`
      );
      // Auto-reconnect after 3 seconds unless deliberately closed
      if (event.code !== 1000) {
        setTimeout(() => {
          connectBinanceLiquidationFeed();
        }, 3_000);
      }
    };

    _ws.onerror = () => {
      console.error("[btc5min] WebSocket error");
    };
  } catch (err) {
    console.error("[btc5min] Failed to connect:", err);
  }

  // Start pruning interval (every 10 seconds)
  if (!_cleanupInterval) {
    _cleanupInterval = setInterval(pruneOldEvents, 10_000);
  }

  return () => disconnectFeed();
}

/** Disconnect and clean up. */
function disconnectFeed(): void {
  if (_ws) {
    _ws.close(1000, "client disconnect");
    _ws = null;
  }
  if (_cleanupInterval) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
  }
  _events = [];
  _priceHistory = [];
}

// ---------------------------------------------------------------------------
// Maker order helpers (feeRateBps always included)
// ---------------------------------------------------------------------------

export interface MakerOrderParams {
  slug: string;
  side: "YES" | "NO";
  price: number; // 0-1
  size: number; // USDC
  feeRateBps: number;
}

/**
 * Build a maker order payload.
 * Always includes feeRateBps per project rules.
 * Paper trade only — does not execute.
 */
export function buildMakerOrder(params: MakerOrderParams) {
  return {
    marketSlug: params.slug,
    side: params.side,
    price: params.price,
    size: params.size,
    orderType: "LIMIT" as const,
    feeRateBps: params.feeRateBps,
    mode: "paper" as const,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Kalshi API Integration (Sprint 6)
// Uses env vars: KALSHI_API_KEY, KALSHI_API_SECRET
// Paper mode by default — respects paperMode gate from dashboard
// ---------------------------------------------------------------------------

export interface KalshiOrderParams {
  ticker: string; // Kalshi event ticker
  side: "yes" | "no";
  count: number; // Number of contracts
  limitPrice: number; // Price in cents (1-99)
  paperMode: boolean;
}

export interface KalshiOrderResult {
  success: boolean;
  orderId: string | null;
  error: string | null;
  paperMode: boolean;
}

/**
 * Place an order on Kalshi.
 * In paper mode: logs the order but doesn't execute.
 * In live mode: calls Kalshi REST API.
 * Edge-compatible (uses fetch, no Node deps).
 */
export async function placeKalshiOrder(
  params: KalshiOrderParams,
  apiKey?: string
): Promise<KalshiOrderResult> {
  // Paper mode — log and return mock result
  if (params.paperMode || !apiKey) {
    console.log(
      `[kalshi] PAPER ORDER: ${params.side.toUpperCase()} ${params.count}x ${params.ticker} @ ${params.limitPrice}¢`
    );
    return {
      success: true,
      orderId: `paper-${Date.now()}`,
      error: null,
      paperMode: true,
    };
  }

  // Live mode — call Kalshi API
  try {
    const res = await fetch("https://api.elections.kalshi.com/trade-api/v2/portfolio/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ticker: params.ticker,
        action: "buy",
        side: params.side,
        count: params.count,
        type: "limit",
        yes_price: params.side === "yes" ? params.limitPrice : undefined,
        no_price: params.side === "no" ? params.limitPrice : undefined,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return {
        success: false,
        orderId: null,
        error: `Kalshi API ${res.status}: ${errBody.slice(0, 200)}`,
        paperMode: false,
      };
    }

    const data = await res.json();
    return {
      success: true,
      orderId: data?.order?.order_id ?? null,
      error: null,
      paperMode: false,
    };
  } catch (err) {
    return {
      success: false,
      orderId: null,
      error: err instanceof Error ? err.message : "Unknown error",
      paperMode: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Telegram Alerts (Sprint 6)
// Uses env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Edge-compatible (uses fetch)
// ---------------------------------------------------------------------------

export interface TelegramAlert {
  type: "signal" | "trade" | "killswitch" | "error";
  title: string;
  body: string;
}

/**
 * Send a Telegram alert.
 * Silently fails if bot token or chat ID is missing.
 * Edge-compatible — uses fetch only.
 */
export async function sendTelegramAlert(
  alert: TelegramAlert,
  botToken?: string,
  chatId?: string
): Promise<boolean> {
  if (!botToken || !chatId) return false;

  const emoji =
    alert.type === "signal" ? "📊"
    : alert.type === "trade" ? "💰"
    : alert.type === "killswitch" ? "🔴"
    : "⚠️";

  const text = `${emoji} *PolyBot — ${alert.title}*\n\n${alert.body}`;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Format a combined signal as a Telegram alert message.
 */
export function formatSignalAlert(
  signal: Btc5MinSignal,
  combined: CombinedSignal
): TelegramAlert {
  const dir = combined.direction === "UP" ? "🟢 UP" : combined.direction === "DOWN" ? "🔴 DOWN" : "⚪ NEUTRAL";
  const conf = `${Math.round(combined.combinedConfidence * 100)}%`;
  const execute = combined.shouldExecute ? "✅ EXECUTE" : "⏭️ SKIP";

  const body = [
    `Direction: ${dir}`,
    `Combined Confidence: ${conf}`,
    `Action: ${execute}`,
    ``,
    `Claude: ${combined.claudeActive ? `Active (${combined.claudeConfidence}%)` : "Inactive"}`,
    `MACD Histogram: ${combined.macdHistogram}`,
    ``,
    `Liquidations (60s): $${signal.liquidation.totalUsd.toLocaleString()}`,
    `Window: ${signal.slug}`,
    `Time left: ${Math.floor(signal.secondsRemaining / 60)}:${String(signal.secondsRemaining % 60).padStart(2, "0")}`,
    ``,
    `Reason: ${combined.reason}`,
  ].join("\n");

  return {
    type: "signal",
    title: `BTC 5-Min Signal — ${dir}`,
    body,
  };
}
