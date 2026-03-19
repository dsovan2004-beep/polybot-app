// ============================================================================
// PolyBot — BTC 5-Minute Liquidation Strategy
// Connects to Binance forced liquidation WebSocket feed
// Tracks rolling 60s window of BTC LONG liquidations
// Signals when cumulative liquidation exceeds $500K threshold
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

interface Btc5MinSignal {
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
}

// ---------------------------------------------------------------------------
// State — rolling window of liquidation events
// ---------------------------------------------------------------------------

let _events: LiquidationEvent[] = [];
let _ws: WebSocket | null = null;
let _cleanupInterval: ReturnType<typeof setInterval> | null = null;

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

/** Get the full signal state for the API. */
export function getBtc5MinSignal(): Btc5MinSignal {
  const liq = getLiquidationWindow();
  const signalActive = liq.totalUsd >= SIGNAL_THRESHOLD_USD;
  const confidence = signalActive ? getConfidence(liq.totalUsd) : 0;

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
