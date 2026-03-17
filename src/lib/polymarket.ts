// ============================================================================
// PolyBot — Polymarket WebSocket Client & Market Utilities
// Rule: WebSocket only — no REST polling
// ============================================================================

import type {
  Market,
  MarketCategory,
  Side,
  WSInboundMessage,
  WSSubscribe,
  WSConnectionState,
  WSPriceUpdate,
  WSTrade,
  WSWhaleTrade,
  WhaleActivity,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLYMARKET_WS_URL =
  process.env.NEXT_PUBLIC_POLYMARKET_WS_URL ??
  "wss://ws-subscriptions-clob.polymarket.com/ws/market";

const RECONNECT_INTERVAL_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 20;
const HEARTBEAT_INTERVAL_MS = 30_000;
const WHALE_SIZE_THRESHOLD = 10_000; // USDC — anything larger is "whale"

// ---------------------------------------------------------------------------
// Allowed categories (max 2 per project rules)
// ---------------------------------------------------------------------------

const ALLOWED_CATEGORIES: MarketCategory[] = ["ai_tech", "politics"];

export function isAllowedCategory(cat: string): cat is MarketCategory {
  return ALLOWED_CATEGORIES.includes(cat as MarketCategory);
}

// ---------------------------------------------------------------------------
// Event emitter helpers (tiny typed pub/sub)
// ---------------------------------------------------------------------------

type Listener<T> = (data: T) => void;

class Emitter<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<Listener<any>>>();

  on<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.off(event, fn);
  }

  off<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>) {
    this.listeners.get(event)?.delete(fn);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]) {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }
}

// ---------------------------------------------------------------------------
// PolymarketWS — WebSocket client
// ---------------------------------------------------------------------------

interface PolymarketEvents {
  price: WSPriceUpdate;
  trade: WSTrade;
  whale: WSWhaleTrade;
  message: WSInboundMessage;
  connected: void;
  disconnected: { code: number; reason: string };
  error: { message: string };
  stateChange: WSConnectionState;
}

export class PolymarketWS extends Emitter<PolymarketEvents> {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private state: WSConnectionState;
  private shouldReconnect = true;

  constructor(private url: string = POLYMARKET_WS_URL) {
    super();
    this.state = {
      connected: false,
      url: this.url,
      reconnectAttempts: 0,
      lastHeartbeat: null,
      subscribedChannels: [],
    };
  }

  /** Current connection state (immutable snapshot). */
  getState(): Readonly<WSConnectionState> {
    return { ...this.state };
  }

  // -----------------------------------------------------------------------
  // Connect / Disconnect
  // -----------------------------------------------------------------------

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = this.handleOpen;
      this.ws.onmessage = this.handleMessage;
      this.ws.onclose = this.handleClose;
      this.ws.onerror = this.handleError;
    } catch (err) {
      this.emit("error", {
        message: err instanceof Error ? err.message : "WebSocket connect failed",
      });
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.updateState({ connected: false });
  }

  // -----------------------------------------------------------------------
  // Subscribe / Unsubscribe
  // -----------------------------------------------------------------------

  subscribe(marketIds: string[], channels: string[] = ["price", "trade"]): void {
    this.send({
      action: "subscribe",
      channels,
      marketIds,
    });
    this.updateState({
      subscribedChannels: [
        ...new Set([...this.state.subscribedChannels, ...channels]),
      ],
    });
  }

  unsubscribe(marketIds: string[], channels: string[] = ["price", "trade"]): void {
    this.send({
      action: "unsubscribe",
      channels,
      marketIds,
    });
  }

  // -----------------------------------------------------------------------
  // Internal handlers
  // -----------------------------------------------------------------------

  private handleOpen = () => {
    this.updateState({ connected: true, reconnectAttempts: 0 });
    this.startHeartbeat();
    this.emit("connected", undefined as unknown as void);
  };

  private handleMessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WSInboundMessage;

      // Emit typed events for common message types
      switch (msg.type) {
        case "price_update":
          this.emit("price", msg);
          break;
        case "trade":
          this.emit("trade", msg);
          break;
        case "whale_trade":
          this.emit("whale", msg);
          break;
        case "heartbeat":
          this.updateState({ lastHeartbeat: msg.timestamp });
          break;
        case "error":
          this.emit("error", { message: msg.message });
          break;
      }

      // Always emit the raw message too
      this.emit("message", msg);
    } catch {
      this.emit("error", { message: "Failed to parse WS message" });
    }
  };

  private handleClose = (event: CloseEvent) => {
    this.updateState({ connected: false });
    this.clearTimers();
    this.emit("disconnected", { code: event.code, reason: event.reason });

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  };

  private handleError = () => {
    this.emit("error", { message: "WebSocket error" });
  };

  // -----------------------------------------------------------------------
  // Reconnect
  // -----------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit("error", { message: "Max reconnect attempts reached" });
      return;
    }

    const delay =
      RECONNECT_INTERVAL_MS * Math.pow(1.5, this.state.reconnectAttempts);

    this.reconnectTimer = setTimeout(() => {
      this.updateState({
        reconnectAttempts: this.state.reconnectAttempts + 1,
      });
      this.connect();
    }, delay);
  }

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------

  private send(payload: WSSubscribe): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private updateState(patch: Partial<WSConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit("stateChange", this.state);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Market helpers
// ---------------------------------------------------------------------------

/** Filter markets to only allowed categories. */
export function filterAllowedMarkets(markets: Market[]): Market[] {
  return markets.filter((m) => ALLOWED_CATEGORIES.includes(m.category));
}

/** Calculate the spread of a market in basis points. */
export function calcSpreadBps(market: Market): number {
  const [yes, no] = market.outcomePrices;
  const mid = (yes + no) / 2;
  if (mid === 0) return 0;
  return Math.round((Math.abs(yes - no) / mid) * 10_000);
}

/** Calculate implied probability from a price (0-1). */
export function impliedProbability(price: number): number {
  return Math.max(0, Math.min(1, price));
}

/** Check if a trade size qualifies as a whale trade. */
export function isWhaleTrade(size: number, threshold = WHALE_SIZE_THRESHOLD): boolean {
  return size >= threshold;
}

/** Build a WhaleActivity record from a WS whale trade message. */
export function whaleActivityFromWS(msg: WSWhaleTrade): Omit<WhaleActivity, "id" | "totalPosition" | "historicalAccuracy"> {
  return {
    marketId: msg.marketId,
    walletAddress: msg.walletAddress,
    side: msg.side,
    size: msg.size,
    price: msg.price,
    detectedAt: msg.timestamp,
  };
}

/** Calculate expected value of a position. */
export function expectedValue(
  probability: number,
  price: number,
  size: number
): number {
  return (probability - price) * size;
}

/** Check if a confidence level meets the project minimum (67%). */
export function meetsConfidenceThreshold(
  confidence: number,
  minConfidence = 0.67
): boolean {
  return confidence >= minConfidence;
}

// ---------------------------------------------------------------------------
// Singleton export (connect once, share across the app)
// ---------------------------------------------------------------------------

let _instance: PolymarketWS | null = null;

export function getPolymarketWS(): PolymarketWS {
  if (!_instance) {
    _instance = new PolymarketWS();
  }
  return _instance;
}
