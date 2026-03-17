// ============================================================================
// PolyBot — Core Type Definitions
// AI-powered Polymarket trading bot
// Stack: Next.js 15 · Cloudflare Workers · Supabase · Claude API · OpenRouter
// Rules: Paper trade first · WebSocket only · 2 categories · 67% min · Kill -20%/24h
// ============================================================================

// ---------------------------------------------------------------------------
// Enums & Literal Types
// ---------------------------------------------------------------------------

export type MarketCategory = "ai_tech" | "politics";
export type StrategyName = "maker_bot" | "ai_news_lag" | "logical_arbitrage";
export type TradingMode = "paper" | "live";
export type Side = "yes" | "no";
export type BotStatus = "idle" | "running" | "paused" | "killed" | "error";
export type AIProvider = "claude" | "openrouter";

export type OrderStatus =
  | "pending"
  | "open"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "expired"
  | "rejected";

export type MarketStatus = "active" | "closed" | "resolved" | "paused";

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

/** A binary-outcome market on Polymarket. */
export interface Market {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  description: string;
  category: MarketCategory;
  status: MarketStatus;
  outcomes: [string, string];
  outcomePrices: [number, number];
  volume: number;
  liquidity: number;
  spreadBps: number;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

/** A trade signal emitted by any strategy or the AI swarm. */
export interface Signal {
  id: string;
  marketId: string;
  strategyName: StrategyName;
  side: Side;
  confidence: number; // 0-1, must be >= 0.67 to act
  suggestedPrice: number;
  suggestedSize: number;
  reasoning: string;
  aiProvider: AIProvider;
  modelId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

/** A completed (or in-progress) trade record persisted to Supabase. */
export interface Trade {
  id: string;
  orderId: string;
  marketId: string;
  strategyName: StrategyName;
  side: Side;
  price: number;
  size: number;
  filledSize: number;
  avgFillPrice: number | null;
  status: OrderStatus;
  mode: TradingMode;
  pnl: number | null;
  fees: number;
  aiConfidence: number;
  aiReasoning: string;
  signalId: string | null;
  createdAt: string;
  closedAt: string | null;
}

// ---------------------------------------------------------------------------
// Rebate
// ---------------------------------------------------------------------------

/** Maker rebate earned from providing liquidity on Polymarket. */
export interface Rebate {
  id: string;
  tradeId: string;
  marketId: string;
  amount: number; // USDC
  rebateRate: number; // e.g. 0.001 = 10 bps
  tier: string; // maker tier
  earnedAt: string;
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

/** Rolling performance snapshot for dashboard & risk monitoring. */
export interface Performance {
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalTrades: number;
  winRate: number; // 0-1
  avgConfidence: number;
  totalVolume: number;
  totalRebates: number;
  sharpeRatio: number | null;
  maxDrawdownPercent: number;
  drawdownPercent24h: number;
  equity: number;
  exposure: number;
  openPositionCount: number;
  killSwitchTriggered: boolean;
  periodStart: string;
  periodEnd: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Whale Activity & Alerts
// ---------------------------------------------------------------------------

/** A single large-wallet trade detected on-chain or via WS. */
export interface WhaleActivity {
  id: string;
  marketId: string;
  walletAddress: string;
  side: Side;
  size: number;
  price: number;
  totalPosition: number; // wallet's total position after this trade
  historicalAccuracy: number | null; // 0-1, how often this wallet is right
  detectedAt: string;
}

/** Alert generated when whale activity crosses a threshold. */
export interface WhaleAlert {
  id: string;
  whaleActivityId: string;
  marketId: string;
  alertType: "large_trade" | "position_flip" | "new_entry" | "full_exit";
  severity: "low" | "medium" | "high";
  message: string;
  actionable: boolean;
  suggestedSide: Side | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// AI Swarm — Multi-model consensus
// ---------------------------------------------------------------------------

/** A single AI model's vote during swarm analysis. */
export interface SwarmVote {
  id: string;
  swarmSessionId: string;
  marketId: string;
  provider: AIProvider;
  modelId: string;
  predictedSide: Side;
  confidence: number;
  reasoning: string;
  keyFactors: string[];
  latencyMs: number;
  votedAt: string;
}

/** Aggregated result from a swarm session (multiple AI votes). */
export interface SwarmResult {
  id: string;
  marketId: string;
  votes: SwarmVote[];
  totalModels: number;
  yesVotes: number;
  noVotes: number;
  avgConfidence: number;
  maxConfidence: number;
  minConfidence: number;
  consensusReached: boolean; // true if agreement + confidence >= 0.67
  consensusSide: Side | null;
  consensusConfidence: number | null;
  dissent: string[]; // reasoning from dissenting models
  createdAt: string;
}

/** Final consensus output used to decide whether to trade. */
export interface ConsensusResult {
  marketId: string;
  side: Side;
  confidence: number; // must be >= 0.67
  agreement: number; // 0-1, fraction of models that agree
  reasoning: string; // synthesized reasoning
  shouldTrade: boolean; // confidence >= 0.67 && agreement >= 0.6
  swarmResultId: string;
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Maker Bot
// ---------------------------------------------------------------------------

/** A limit order placed by the Maker Bot strategy. */
export interface MakerOrder {
  id: string;
  marketId: string;
  side: Side;
  price: number;
  size: number;
  status: OrderStatus;
  mode: TradingMode;
  spreadBps: number;
  inventorySkew: number;
  isRefresh: boolean; // true if this replaced a stale order
  placedAt: string;
  expiresAt: string | null;
  filledAt: string | null;
}

// ---------------------------------------------------------------------------
// External Data — Binance & News
// ---------------------------------------------------------------------------

/** Real-time tick from Binance (for cross-market correlation). */
export interface BinanceTick {
  symbol: string; // e.g. "BTCUSDT"
  price: number;
  volume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  timestamp: string;
}

/** A news article or headline for the AI News Lag strategy. */
export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  category: MarketCategory;
  sentiment: number; // -1 to 1
  relevanceScore: number; // 0-1
  relatedMarketIds: string[];
  publishedAt: string;
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Arbitrage
// ---------------------------------------------------------------------------

/** An arbitrage opportunity across correlated markets. */
export interface ArbitrageOpportunity {
  id: string;
  marketA: { id: string; question: string; price: number; side: Side };
  marketB: { id: string; question: string; price: number; side: Side };
  correlation: number; // 0-1
  edge: number; // expected value edge
  impliedProbabilityGap: number;
  strategyName: "logical_arbitrage";
  confidence: number;
  reasoning: string;
  expiresAt: string;
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// Bot Config
// ---------------------------------------------------------------------------

/** Top-level runtime config for the entire bot. */
export interface BotConfig {
  mode: TradingMode;
  categories: MarketCategory[];
  minConfidence: number; // 0.67 per project rules
  killSwitch: {
    enabled: boolean;
    maxDrawdownPercent: number; // 20 per project rules
    windowHours: number; // 24 per project rules
    action: "pause" | "close_all" | "kill";
  };
  strategies: {
    makerBot: {
      enabled: boolean;
      spreadBps: number;
      refreshIntervalMs: number;
      inventorySkew: number;
      maxPositionSize: number;
      maxOpenPositions: number;
    };
    aiNewsLag: {
      enabled: boolean;
      newsSourceUrls: string[];
      lagThresholdMs: number;
      sentimentThreshold: number;
      maxPositionSize: number;
    };
    logicalArbitrage: {
      enabled: boolean;
      correlationThreshold: number;
      minEdge: number;
      maxMarketPairs: number;
      maxPositionSize: number;
    };
  };
  ai: {
    primaryProvider: AIProvider;
    primaryModel: string;
    fallbackProvider: AIProvider;
    fallbackModel: string;
    swarmModels: { provider: AIProvider; modelId: string }[];
  };
  ws: {
    polymarketUrl: string;
    binanceUrl: string;
    reconnectIntervalMs: number;
    maxReconnectAttempts: number;
    heartbeatIntervalMs: number;
  };
  supabase: {
    url: string;
    anonKey: string;
  };
}

// ---------------------------------------------------------------------------
// WebSocket Messages (Polymarket — WS only, no REST)
// ---------------------------------------------------------------------------

export type WSInboundType =
  | "price_update"
  | "trade"
  | "order_update"
  | "market_update"
  | "whale_trade"
  | "error"
  | "heartbeat";

export interface WSMessageBase {
  type: WSInboundType;
  timestamp: string;
}

export interface WSPriceUpdate extends WSMessageBase {
  type: "price_update";
  marketId: string;
  prices: [number, number];
  volume24h: number;
}

export interface WSTrade extends WSMessageBase {
  type: "trade";
  marketId: string;
  side: Side;
  price: number;
  size: number;
  tradeId: string;
}

export interface WSOrderUpdate extends WSMessageBase {
  type: "order_update";
  orderId: string;
  status: OrderStatus;
  filledSize: number;
  avgFillPrice: number | null;
}

export interface WSMarketUpdate extends WSMessageBase {
  type: "market_update";
  market: Market;
}

export interface WSWhaleTrade extends WSMessageBase {
  type: "whale_trade";
  marketId: string;
  walletAddress: string;
  side: Side;
  size: number;
  price: number;
}

export interface WSError extends WSMessageBase {
  type: "error";
  code: string;
  message: string;
}

export interface WSHeartbeat extends WSMessageBase {
  type: "heartbeat";
}

export type WSInboundMessage =
  | WSPriceUpdate
  | WSTrade
  | WSOrderUpdate
  | WSMarketUpdate
  | WSWhaleTrade
  | WSError
  | WSHeartbeat;

export interface WSSubscribe {
  action: "subscribe" | "unsubscribe";
  channels: string[];
  marketIds?: string[];
}

export interface WSConnectionState {
  connected: boolean;
  url: string;
  reconnectAttempts: number;
  lastHeartbeat: string | null;
  subscribedChannels: string[];
}

// ---------------------------------------------------------------------------
// API Envelope
// ---------------------------------------------------------------------------

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardData {
  botStatus: BotStatus;
  mode: TradingMode;
  performance: Performance;
  positions: Trade[];
  recentSignals: Signal[];
  whaleAlerts: WhaleAlert[];
  lastSwarmResult: SwarmResult | null;
  wsState: WSConnectionState;
  updatedAt: string;
}
