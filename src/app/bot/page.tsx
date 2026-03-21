"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  MarketRow,
  SignalRow,
} from "@/lib/supabase";

// ============================================================================
// PolyBot Dashboard — /bot  (Sprint 3)
// Dark-mode, CSS variables, flat design, no shadows/gradients
// BTC 5-Min Live + Signals + Whale Watch
// ============================================================================

// ---------------------------------------------------------------------------
// CSS variable helpers
// ---------------------------------------------------------------------------

const css = {
  bg: "var(--color-background-primary, #0f172a)",
  bgCard: "var(--color-background-primary, #1e293b)",
  border: "var(--color-border-tertiary, rgba(148,163,184,0.15))",
  textPrimary: "var(--color-text-primary, #f8fafc)",
  textSecondary: "var(--color-text-secondary, #94a3b8)",
  radius: "var(--border-radius-lg, 12px)",
  indigo: "#6366f1",
};

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface MarketsApiData {
  markets: MarketRow[];
  whales: WhaleRow[];
  signals: SignalRow[];
  connected: boolean;
}

interface Btc5MinData {
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

interface WhaleRow {
  id: string;
  market_id: string;
  wallet_address: string;
  direction: string;
  trade_size_usd: number;
  price_at_trade: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchMarkets(): Promise<MarketsApiData> {
  const res = await fetch("/api/markets");
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Failed to load markets");
  return json.data;
}

async function fetchSwarmSignal(market: MarketRow): Promise<SignalRow | null> {
  try {
    const res = await fetch("/api/swarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        market: {
          id: market.id,
          polymarket_id: market.polymarket_id,
          title: market.title,
          category: market.category,
          current_price: market.current_price ?? 0.5,
          volume_24h: market.volume_24h,
          liquidity: market.liquidity,
          closes_at: market.closes_at,
        },
      }),
    });
    const json = await res.json();
    if (!json.ok) return null;
    return json.data as SignalRow;
  } catch {
    return null;
  }
}

async function fetchBtc5Min(): Promise<Btc5MinData> {
  const res = await fetch("/api/btc5min");
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Failed to load");
  return json.data;
}

interface KalshiPositionRow {
  ticker: string;
  title: string;
  market_exposure: number;
  resting_orders_count: number;
  total_traded: number;
}

interface BalanceData {
  kalshi: number;
  openPositions: number;
  positions: KalshiPositionRow[];
  totalPnl: number;
  winRate: number;
  tradesCount: number;
  wins: number;
  totalValue: number;
  lastAlertAt: string | null;
  paperMode: boolean;
}

async function fetchBalance(): Promise<BalanceData> {
  const res = await fetch("/api/balance");
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Failed to load balance");
  return json.data;
}

async function executeTrade(
  signal: { id: string; market_id: string; consensus: string; confidence: number; market_price: number; strategy: string },
  marketTicker: string,
  paperTrade: boolean
): Promise<{ orderId: string; size: number; paperTrade: boolean }> {
  const res = await fetch("/api/trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signal, marketTicker, paperTrade }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Trade failed");
  return json.data;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmt$(n: number | null): string {
  if (n === null || n === undefined) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "0%";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function pnlColor(n: number | null): string {
  if (n === null) return css.textSecondary;
  if (n > 0) return "#4ade80";
  if (n < 0) return "#f87171";
  return css.textSecondary;
}

// ---------------------------------------------------------------------------
// Card wrapper
// ---------------------------------------------------------------------------

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: css.bgCard,
        border: `0.5px solid ${css.border}`,
        borderRadius: css.radius,
        padding: "16px",
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <Card>
      <p style={{ fontSize: 11, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </p>
      <p style={{ fontSize: 24, fontWeight: 700, color: color ?? css.textPrimary, marginTop: 4 }}>
        {value}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// BTC 5-Min Panel
// ---------------------------------------------------------------------------

function Btc5MinPanel({ data }: { data: Btc5MinData | null }) {
  if (!data) {
    return (
      <Card>
        <p style={{ color: css.textSecondary, textAlign: "center", padding: 24 }}>
          Connecting to BTC feed...
        </p>
      </Card>
    );
  }

  const liq = data.liquidation;
  const progressPct = Math.min(100, (liq.totalUsd / 500_000) * 100);
  const isActive = liq.signalActive;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: css.textPrimary }}>BTC 5-Min Live</p>
          <p style={{ fontSize: 11, color: css.textSecondary, fontFamily: "monospace", marginTop: 2 }}>
            {data.slug}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isActive ? "#4ade80" : "#64748b",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 12, color: isActive ? "#4ade80" : "#64748b", fontWeight: 500 }}>
            {isActive ? "SIGNAL ACTIVE" : "WATCHING"}
          </span>
        </div>
      </div>

      {/* Countdown */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 48, fontWeight: 700, color: "#f97316", fontFamily: "monospace" }}>
          {Math.floor(data.secondsRemaining / 60)}:{String(data.secondsRemaining % 60).padStart(2, "0")}
        </p>
        <p style={{ fontSize: 11, color: css.textSecondary }}>seconds remaining</p>
      </div>

      {/* Liquidation progress bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: css.textSecondary }}>Liquidations (60s)</span>
          <span style={{ fontSize: 12, color: css.textPrimary, fontFamily: "monospace" }}>
            {fmtK(liq.totalUsd)} / $500K
          </span>
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 4,
            background: "rgba(148,163,184,0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              borderRadius: 4,
              background: isActive ? "#4ade80" : css.indigo,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
        <div>
          <p style={{ fontSize: 11, color: css.textSecondary }}>Trades</p>
          <p style={{ fontSize: 16, fontWeight: 600, color: css.textPrimary }}>{liq.tradeCount}</p>
        </div>
        {isActive && (
          <div>
            <p style={{ fontSize: 11, color: css.textSecondary }}>Confidence</p>
            <p style={{ fontSize: 16, fontWeight: 600, color: "#4ade80" }}>
              {(liq.confidence * 100).toFixed(0)}%
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Signal Card
// ---------------------------------------------------------------------------

function SignalCard({ signal, markets }: { signal: SignalRow; markets: MarketRow[] }) {
  const consensus = signal.consensus ?? "NO_TRADE";
  const badgeColor =
    consensus === "YES" ? "#4ade80" : consensus === "NO" ? "#f87171" : "#64748b";
  const badgeBg =
    consensus === "YES"
      ? "rgba(74,222,128,0.1)"
      : consensus === "NO"
      ? "rgba(248,113,113,0.1)"
      : "rgba(100,116,139,0.1)";
  const borderLeft =
    consensus === "YES" || consensus === "NO" ? css.indigo : "#64748b";

  const confidence = signal.confidence ?? 0;
  const confidencePct = Math.min(100, confidence);

  // Use joined market_title from Supabase query; fall back to markets array, then ticker
  const marketTitle = signal.market_title
    ?? markets.find((m) => m.id === signal.market_id)?.title
    ?? "Unknown market";

  // Strategy display — format nicely
  const strategy = signal.strategy ?? "unknown";
  const strategyLabel = strategy === "news_lag" ? "News Lag"
    : strategy === "sentiment_fade" ? "Sentiment Fade"
    : strategy === "logical_arb" ? "Logical Arb"
    : strategy === "maker" ? "Maker"
    : strategy === "self_test" ? "Self Test"
    : strategy === "unknown" ? "AI Analysis"
    : strategy;

  return (
    <div
      style={{
        borderLeft: `3px solid ${borderLeft}`,
        borderRadius: css.radius,
        border: `0.5px solid ${css.border}`,
        borderLeftWidth: 3,
        borderLeftColor: borderLeft,
        padding: "12px 16px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, color: css.textPrimary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {marketTitle}
          </p>
          <p style={{ fontSize: 11, color: css.textSecondary, marginTop: 2 }}>
            {fmtTime(signal.created_at)}
            {signal.reasoning && (
              <span style={{ marginLeft: 8 }}>— {signal.reasoning.slice(0, 60)}</span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              color: badgeColor,
              background: badgeBg,
            }}
          >
            {consensus}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(99,102,241,0.1)",
              color: css.indigo,
            }}
          >
            {strategyLabel}
          </span>
        </div>
      </div>

      {/* Confidence bar */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
          <span style={{ fontSize: 11, color: css.textSecondary }}>Confidence</span>
          <span style={{ fontSize: 11, color: css.textPrimary, fontFamily: "monospace" }}>
            {confidence}%
          </span>
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: "rgba(148,163,184,0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${confidencePct}%`,
              borderRadius: 2,
              background: css.indigo,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Market Row with Signal Badge
// ---------------------------------------------------------------------------

function MarketRowItem({
  market,
  signal,
  isPaper,
  onExecute,
}: {
  market: MarketRow;
  signal: SignalRow | undefined;
  isPaper: boolean;
  onExecute?: (signal: SignalRow, market: MarketRow) => void;
}) {
  const vote = signal?.consensus ?? null;
  const confidence = signal?.confidence ?? null;

  const badgeColor =
    vote === "YES" ? "#4ade80" : vote === "NO" ? "#f87171" : "#64748b";
  const badgeBg =
    vote === "YES"
      ? "rgba(74,222,128,0.1)"
      : vote === "NO"
      ? "rgba(248,113,113,0.1)"
      : "rgba(100,116,139,0.1)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: `0.5px solid ${css.border}`,
        gap: 12,
      }}
    >
      {/* Title */}
      <p
        style={{
          fontSize: 13,
          color: css.textPrimary,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {market.title?.slice(0, 55) ?? "Untitled"}
      </p>

      {/* Price */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#4ade80",
          fontFamily: "monospace",
          width: 55,
          textAlign: "right",
        }}
      >
        {fmtPct(market.current_price)}
      </span>

      {/* Signal badge */}
      {vote ? (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            color: badgeColor,
            background: badgeBg,
            width: 72,
            textAlign: "center",
          }}
        >
          {vote}
        </span>
      ) : (
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: "2px 8px",
            borderRadius: 4,
            color: css.textSecondary,
            background: "rgba(100,116,139,0.1)",
            width: 72,
            textAlign: "center",
          }}
        >
          pending
        </span>
      )}

      {/* Confidence */}
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: confidence && confidence >= 67 ? css.indigo : css.textSecondary,
          fontFamily: "monospace",
          width: 50,
          textAlign: "right",
        }}
      >
        {confidence !== null ? `${confidence}%` : "—"}
      </span>

      {/* Paper/Live badge */}
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: "1px 5px",
          borderRadius: 3,
          background: isPaper ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
          color: isPaper ? "#4ade80" : "#f87171",
          width: 38,
          textAlign: "center",
        }}
      >
        {isPaper ? "PAPER" : "LIVE"}
      </span>

      {/* Execute button — only in LIVE mode with actionable signal */}
      {!isPaper && signal && (signal.consensus === "YES" || signal.consensus === "NO") && onExecute && (
        <button
          onClick={() => onExecute(signal, market)}
          title={`Confidence: ${signal.confidence ?? 0}% | Gap: ${signal.price_gap != null ? (signal.price_gap * 100).toFixed(1) : "?"}% | Strategy: ${signal.strategy ?? "unknown"}`}
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            background: "rgba(99,102,241,0.15)",
            color: css.indigo,
            border: `1px solid rgba(99,102,241,0.3)`,
            cursor: "pointer",
            width: 52,
          }}
        >
          EXEC
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Whale Row
// ---------------------------------------------------------------------------

function WhaleRowItem({ whale, markets }: { whale: WhaleRow; markets: MarketRow[] }) {
  const matchedMarket = markets.find((m) => m.id === whale.market_id);
  const marketLabel = matchedMarket?.title?.slice(0, 40) ?? whale.market_id.slice(0, 8) + "...";
  const dirColor = whale.direction === "yes" || whale.direction === "YES" ? "#4ade80" : "#f87171";
  const dirBg = whale.direction === "yes" || whale.direction === "YES"
    ? "rgba(74,222,128,0.1)"
    : "rgba(248,113,113,0.1)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: `0.5px solid ${css.border}`,
      }}
    >
      <p style={{ fontSize: 13, color: css.textPrimary, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {marketLabel}
      </p>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 4,
          color: dirColor,
          background: dirBg,
          marginRight: 12,
        }}
      >
        {whale.direction.toUpperCase()}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: css.textPrimary, fontFamily: "monospace", width: 80, textAlign: "right" }}>
        {fmtK(whale.trade_size_usd)}
      </span>
      <span style={{ fontSize: 11, color: css.textSecondary, width: 70, textAlign: "right" }}>
        {timeAgo(whale.created_at)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function BotDashboard() {
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [whales, setWhales] = useState<WhaleRow[]>([]);
  const [btc, setBtc] = useState<Btc5MinData | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [paperMode, setPaperMode] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("polybot_paper_mode");
    return saved === null ? true : saved === "true";
  });
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<"all" | "exec" | "live" | "no_trade">("all");

  // Track which markets we've already sent to swarm (avoid duplicate calls)
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());

  // Check kill switch status
  const checkKillSwitch = useCallback(async () => {
    try {
      const res = await fetch("/api/killswitch");
      const json = await res.json();
      if (json.ok) setKillSwitchActive(json.data.active);
    } catch {
      // Silent fail
    }
  }, []);

  // Activate kill switch (called after modal confirmation)
  const activateKillSwitch = useCallback(async () => {
    setShowKillConfirm(false);
    try {
      const res = await fetch("/api/killswitch", { method: "POST" });
      const json = await res.json();
      if (json.ok) setKillSwitchActive(true);
    } catch (err) {
      alert("Failed to activate kill switch: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  }, []);

  // Toggle paper/live mode
  const togglePaperMode = useCallback(() => {
    if (paperMode) {
      // Switching to LIVE — require confirmation
      if (!confirm("Switch to LIVE MODE? Real money will be at risk.")) return;
    }
    setPaperMode((prev) => {
      const next = !prev;
      localStorage.setItem("polybot_paper_mode", String(next));
      return next;
    });
  }, [paperMode]);

  // Fetch markets + whales + signals (every 30s)
  const loadMarkets = useCallback(async () => {
    try {
      const data = await fetchMarkets();
      setMarkets(data.markets);
      setWhales(data.whales);
      setConnected(data.connected);

      // Load existing signals from Supabase (persisted by swarm route)
      if (data.signals && data.signals.length > 0) {
        setSignals(data.signals);
      }

      // For each NEW market without a signal, call swarm to analyze
      const signalMarketIds = new Set(
        (data.signals ?? []).map((s: SignalRow) => s.market_id)
      );
      const unanalyzed = data.markets.filter(
        (m) => !signalMarketIds.has(m.id) && !analyzedIds.has(m.id)
      );

      if (unanalyzed.length > 0) {
        const newIds = new Set(analyzedIds);
        const signalPromises = unanalyzed.slice(0, 3).map(async (m) => {
          newIds.add(m.id);
          return fetchSwarmSignal(m);
        });
        setAnalyzedIds(newIds);

        const results = await Promise.allSettled(signalPromises);
        const newSignals = results
          .filter((r): r is PromiseFulfilledResult<SignalRow | null> => r.status === "fulfilled")
          .map((r) => r.value)
          .filter((s): s is SignalRow => s !== null);

        if (newSignals.length > 0) {
          setSignals((prev) => {
            const ids = new Set(prev.map((s) => s.id));
            const unique = newSignals.filter((s) => !ids.has(s.id));
            return [...unique, ...prev].slice(0, 50);
          });
        }
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [analyzedIds]);

  // Fetch BTC 5-min data (every 5s)
  const loadBtc = useCallback(async () => {
    try {
      const b = await fetchBtc5Min();
      setBtc(b);
    } catch {
      // Silent fail — BTC panel shows "connecting"
    }
  }, []);

  // Fetch Kalshi balance
  const loadBalance = useCallback(async () => {
    try {
      const data = await fetchBalance();
      setBalanceData(data);
    } catch {
      // Silent fail
    }
  }, []);

  // Auto-clear toast after 4 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    loadMarkets();
    loadBtc();
    checkKillSwitch();
    loadBalance();
    const dashInterval = setInterval(loadMarkets, 30_000);
    const btcInterval = setInterval(loadBtc, 5_000);
    const killInterval = setInterval(checkKillSwitch, 60_000);
    const balInterval = setInterval(loadBalance, 60_000);
    return () => {
      clearInterval(dashInterval);
      clearInterval(btcInterval);
      clearInterval(killInterval);
      clearInterval(balInterval);
    };
  }, [loadMarkets, loadBtc, checkKillSwitch, loadBalance]);

  // Execute trade handler
  const handleExecute = useCallback(
    async (signal: SignalRow, market: MarketRow) => {
      if (paperMode) return; // Safety: only in LIVE mode
      if (
        !confirm(
          `Execute ${signal.consensus} on "${market.title?.slice(0, 40)}"? This will place a REAL order.`
        )
      )
        return;

      try {
        const result = await executeTrade(
          {
            id: signal.id,
            market_id: signal.market_id ?? "",
            consensus: signal.consensus ?? "NO_TRADE",
            confidence: signal.confidence ?? 0,
            market_price: signal.market_price ?? 0.5,
            strategy: signal.strategy ?? "unknown",
          },
          market.kalshi_ticker ?? market.polymarket_id ?? market.id,
          paperMode
        );
        setToast(
          `Order placed: ${result.orderId?.slice(0, 12)} | $${result.size} | ${result.paperTrade ? "PAPER" : "LIVE"}`
        );
        loadBalance();
      } catch (err) {
        setToast(`Trade failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [paperMode, loadBalance]
  );

  // Performance will be wired to Supabase in a future sprint

  return (
    <div style={{ minHeight: "100vh", background: css.bg, color: css.textPrimary }}>
      {/* ── TOP BAR ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 24px",
          borderBottom: `0.5px solid ${css.border}`,
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: css.bg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            <span style={{ color: css.indigo }}>Poly</span>
            <span style={{ color: css.textPrimary }}>Bot</span>
          </h1>
          <button
            onClick={togglePaperMode}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 500,
              padding: "3px 10px",
              borderRadius: 6,
              background: paperMode ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.15)",
              color: paperMode ? "#4ade80" : "#f87171",
              border: `1px solid ${paperMode ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.4)"}`,
              cursor: "pointer",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: paperMode ? "#4ade80" : "#f87171", display: "inline-block" }} />
            {paperMode ? "PAPER" : "LIVE"}
          </button>
          {balanceData && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: css.textPrimary,
                fontFamily: "monospace",
                padding: "3px 10px",
                borderRadius: 6,
                background: "rgba(99,102,241,0.1)",
                border: `1px solid rgba(99,102,241,0.3)`,
              }}
            >
              {balanceData.paperMode ? "PAPER" : `Balance: $${balanceData.kalshi.toFixed(2)}`}
              {balanceData.openPositions > 0 && ` | ${balanceData.openPositions} pos`}
            </span>
          )}
          {/* Last Telegram alert indicator */}
          {balanceData && (() => {
            const alertAt = balanceData.lastAlertAt;
            if (!alertAt) return (
              <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
                No alerts yet
              </span>
            );
            const minsAgo = Math.floor((Date.now() - new Date(alertAt).getTime()) / 60_000);
            const label = minsAgo < 1 ? "just now" : minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`;
            const alertColor = minsAgo < 5 ? "#4ade80" : minsAgo < 30 ? "#fbbf24" : "#f87171";
            return (
              <span style={{ fontSize: 11, fontWeight: 500, color: alertColor, fontFamily: "monospace" }}>
                Last alert: {label}
              </span>
            );
          })()}
        </div>
        <button
          onClick={() => setShowKillConfirm(true)}
          disabled={killSwitchActive}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "6px 16px",
            borderRadius: 6,
            border: `1px solid ${killSwitchActive ? "#64748b" : "#f87171"}`,
            background: killSwitchActive ? "rgba(100,116,139,0.1)" : "rgba(248,113,113,0.1)",
            color: killSwitchActive ? "#64748b" : "#f87171",
            cursor: killSwitchActive ? "not-allowed" : "pointer",
            opacity: killSwitchActive ? 0.6 : 1,
          }}
        >
          {killSwitchActive ? "KILLED" : "Kill switch"}
        </button>
      </header>

      {/* ── KILL SWITCH CONFIRMATION MODAL ── */}
      {showKillConfirm && (
        <div
          onClick={() => setShowKillConfirm(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setShowKillConfirm(false); }}
          tabIndex={-1}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: css.bgCard,
              border: `1px solid #f87171`,
              borderRadius: css.radius,
              padding: "28px 32px",
              maxWidth: 420,
              width: "90%",
            }}
          >
            <p style={{ fontSize: 18, fontWeight: 700, color: "#f87171", marginBottom: 12 }}>
              Kill all positions?
            </p>
            <p style={{ fontSize: 14, color: css.textSecondary, lineHeight: 1.5, marginBottom: 24 }}>
              This will close {balanceData?.openPositions ?? 0} active trade{(balanceData?.openPositions ?? 0) !== 1 ? "s" : ""}. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowKillConfirm(false)}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "8px 20px",
                  borderRadius: 6,
                  border: `1px solid ${css.border}`,
                  background: "transparent",
                  color: css.textSecondary,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={activateKillSwitch}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "8px 20px",
                  borderRadius: 6,
                  border: "1px solid #f87171",
                  background: "rgba(248,113,113,0.2)",
                  color: "#f87171",
                  cursor: "pointer",
                }}
              >
                Confirm Kill
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>
        {/* ── TOAST ── */}
        {toast && (
          <div
            style={{
              position: "fixed",
              top: 60,
              right: 24,
              zIndex: 50,
              padding: "10px 20px",
              borderRadius: 8,
              background: "#4ade80",
              color: "#0f172a",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            {toast}
          </div>
        )}

        {/* ── KILL SWITCH ALERT ── */}
        {killSwitchActive && (
          <div
            style={{
              padding: "12px 16px",
              marginBottom: 16,
              borderRadius: css.radius,
              border: "1px solid #f87171",
              background: "rgba(248,113,113,0.15)",
              color: "#f87171",
              fontSize: 14,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            KILL SWITCH ACTIVE — Trading halted
          </div>
        )}

        {/* ── RISK SUMMARY BAR ── */}
        {balanceData && balanceData.positions.length > 0 && (() => {
          const totalExposure = balanceData.positions.reduce(
            (sum, p) => sum + Math.abs(p.market_exposure / 100), 0
          );
          const pctDeployed = balanceData.kalshi > 0 ? (totalExposure / balanceData.kalshi) * 100 : 0;
          const posCount = balanceData.positions.length;
          const largest = balanceData.positions.reduce(
            (max, p) => {
              const exp = Math.abs(p.market_exposure / 100);
              return exp > max.exp ? { exp, title: p.title || p.ticker } : max;
            },
            { exp: 0, title: "" }
          );
          const riskColor = pctDeployed > 50 ? "#f87171" : pctDeployed > 25 ? "#fbbf24" : "#4ade80";
          return (
            <div
              style={{
                padding: "8px 16px",
                marginBottom: 12,
                borderRadius: 8,
                border: `0.5px solid ${riskColor}33`,
                background: `${riskColor}0d`,
                fontSize: 12,
                color: riskColor,
                fontFamily: "monospace",
                textAlign: "center",
              }}
            >
              RISK: {fmt$(totalExposure)} deployed ({pctDeployed.toFixed(1)}% of balance) across {posCount} position{posCount !== 1 ? "s" : ""} | Largest: {fmt$(largest.exp)} ({largest.title.slice(0, 20)})
            </div>
          );
        })()}

        {/* ── LIVE MODE WARNING ── */}
        {!paperMode && !killSwitchActive && (
          <div
            style={{
              padding: "12px 16px",
              marginBottom: 16,
              borderRadius: css.radius,
              border: "1px solid #f97316",
              background: "rgba(249,115,22,0.1)",
              color: "#f97316",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            LIVE MODE — Real money at risk
          </div>
        )}

        {/* ── ERROR ── */}
        {error && (
          <div
            style={{
              padding: "12px 16px",
              marginBottom: 16,
              borderRadius: css.radius,
              border: "0.5px solid rgba(248,113,113,0.3)",
              background: "rgba(248,113,113,0.05)",
              color: "#f87171",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* ── GUARDRAILS STATUS ── */}
        <div
          style={{
            padding: "6px 16px",
            marginBottom: 12,
            borderRadius: 8,
            border: "0.5px solid rgba(148,163,184,0.12)",
            background: "rgba(148,163,184,0.04)",
            fontSize: 11,
            color: "rgba(148,163,184,0.55)",
            fontFamily: "monospace",
          }}
        >
          GUARDRAILS: 8 active | Min conf: 67% | Min gap: 10% | Price: 2¢–98¢ | Vol: 500+ | Kill: −20% | No sports | No same-day expiry
        </div>

        {/* ── 4 STAT CARDS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          <StatCard
            label="Total P&L"
            value={fmt$(balanceData?.totalPnl ?? 0)}
            color={pnlColor(balanceData?.totalPnl ?? 0)}
          />
          <StatCard
            label="Win Rate"
            value={balanceData?.tradesCount ? `${fmtPct(balanceData.winRate)} (${balanceData.wins}/${balanceData.tradesCount})` : "No trades yet"}
          />
          <StatCard
            label="Signals Today"
            value={String(signals.length)}
          />
          <StatCard
            label="USDC Rebates"
            value={fmt$(0)}
          />
        </div>

        {/* ── OPEN POSITIONS ── */}
        {balanceData && balanceData.positions && balanceData.positions.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Open Positions ({balanceData.positions.length})
            </p>
            <Card>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${css.border}` }}>
                    {["Market", "Side", "Exposure", "Resting Orders", "Total Traded"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: css.textSecondary, fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {balanceData.positions.map((pos) => {
                    const title = pos.title || pos.ticker;
                    const side = pos.market_exposure >= 0 ? "YES" : "NO";
                    const exposureAbs = Math.abs(pos.market_exposure) / 100;
                    const exposureColor = pos.market_exposure >= 0 ? "#4ade80" : "#f87171";

                    return (
                      <tr key={pos.ticker} style={{ borderBottom: `1px solid ${css.border}` }}>
                        <td style={{ padding: "10px", color: css.textPrimary, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {title}
                        </td>
                        <td style={{ padding: "10px" }}>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: side === "YES" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
                            color: side === "YES" ? "#4ade80" : "#f87171",
                          }}>
                            {side}
                          </span>
                        </td>
                        <td style={{ padding: "10px", color: exposureColor, fontFamily: "monospace", fontWeight: 600 }}>
                          ${exposureAbs.toFixed(2)}
                        </td>
                        <td style={{ padding: "10px", color: css.textSecondary, fontFamily: "monospace" }}>
                          {pos.resting_orders_count}
                        </td>
                        <td style={{ padding: "10px", color: css.textPrimary, fontFamily: "monospace" }}>
                          {pos.total_traded}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* ── MAIN 2-COLUMN GRID ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* LEFT — BTC 5-Min */}
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              BTC 5-Min Live
            </p>
            <Btc5MinPanel data={btc} />
          </div>

          {/* RIGHT — Markets + Signals */}
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
              Markets &amp; Signals ({markets.length})
              {connected && <span style={{ color: "#4ade80", marginLeft: 8, fontSize: 10 }}>WS CONNECTED</span>}
            </p>
            <p style={{ fontSize: 11, color: "rgba(148,163,184,0.6)", marginBottom: 8 }}>
              EXEC shown when confidence &ge; 67% and gap &ge; 10%
            </p>
            {/* Filter tabs */}
            {(() => {
              const execCount = markets.filter((m) => {
                const sig = signals.find((s) => s.market_id === m.id);
                return sig && (sig.consensus === "YES" || sig.consensus === "NO");
              }).length;
              const noTradeCount = markets.filter((m) => {
                const sig = signals.find((s) => s.market_id === m.id);
                return sig && sig.consensus !== "YES" && sig.consensus !== "NO";
              }).length;
              const liveCount = markets.filter((m) => {
                const sig = signals.find((s) => s.market_id === m.id);
                return !sig;
              }).length;
              const tabs: { key: "all" | "exec" | "live" | "no_trade"; label: string; count: number }[] = [
                { key: "all", label: "All", count: markets.length },
                { key: "exec", label: "EXEC", count: execCount },
                { key: "live", label: "LIVE", count: liveCount },
                { key: "no_trade", label: "NO_TRADE", count: noTradeCount },
              ];
              return (
                <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setMarketFilter(tab.key)}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        background: marketFilter === tab.key ? "rgba(99,102,241,0.2)" : "transparent",
                        color: marketFilter === tab.key ? "#f8fafc" : "rgba(148,163,184,0.6)",
                        borderBottom: marketFilter === tab.key ? "2px solid #6366f1" : "2px solid transparent",
                        transition: "all 0.15s",
                      }}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  ))}
                </div>
              );
            })()}
            <Card>
              {markets.length === 0 ? (
                <p style={{ color: css.textSecondary, textAlign: "center", padding: 24, fontSize: 13 }}>
                  No markets yet — start the feed script
                </p>
              ) : (
                <div>
                  {/* Table header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 0 8px",
                      borderBottom: `0.5px solid ${css.border}`,
                      fontSize: 11,
                      color: css.textSecondary,
                      fontWeight: 500,
                      gap: 12,
                    }}
                  >
                    <span style={{ flex: 1 }}>Market</span>
                    <span style={{ width: 55, textAlign: "right" }}>Price</span>
                    <span style={{ width: 72, textAlign: "center" }}>Signal</span>
                    <span style={{ width: 50, textAlign: "right" }}>Conf</span>
                  </div>
                  {/* Market rows — filtered by active tab */}
                  <div style={{ maxHeight: 340, overflowY: "auto" }}>
                    {(() => {
                      const filtered = markets.filter((m) => {
                        if (marketFilter === "all") return true;
                        const sig = signals.find((s) => s.market_id === m.id);
                        if (marketFilter === "exec") return sig && (sig.consensus === "YES" || sig.consensus === "NO");
                        if (marketFilter === "live") return !sig;
                        if (marketFilter === "no_trade") return sig && sig.consensus !== "YES" && sig.consensus !== "NO";
                        return true;
                      });
                      const capped = marketFilter === "all" ? filtered.slice(0, 20) : filtered;
                      if (capped.length === 0) {
                        return (
                          <p style={{ color: css.textSecondary, textAlign: "center", padding: 16, fontSize: 12 }}>
                            No markets match this filter
                          </p>
                        );
                      }
                      return capped.map((m) => {
                        const latestSignal = signals.find((s) => s.market_id === m.id);
                        return (
                          <MarketRowItem
                            key={m.id}
                            market={m}
                            signal={latestSignal}
                            isPaper={paperMode}
                            onExecute={handleExecute}
                          />
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* ── SIGNAL HISTORY ── */}
        {signals.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Signal History ({signals.length})
            </p>
            <div style={{ maxHeight: 600, overflowY: "auto" }}>
              {signals.map((s) => (
                <SignalCard key={s.id} signal={s} markets={markets} />
              ))}
            </div>
          </div>
        )}

        {/* ── BOTTOM — WHALE WATCH ── */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Whale Watch
          </p>
          <Card>
            {whales.length === 0 ? (
              <p style={{ color: css.textSecondary, textAlign: "center", padding: 24, fontSize: 13 }}>
                No whale activity detected
              </p>
            ) : (
              <div>
                {/* Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 0 8px",
                    borderBottom: `0.5px solid ${css.border}`,
                    fontSize: 11,
                    color: css.textSecondary,
                    fontWeight: 500,
                  }}
                >
                  <span style={{ flex: 1 }}>Market</span>
                  <span style={{ width: 70, marginRight: 12 }}>Direction</span>
                  <span style={{ width: 80, textAlign: "right" }}>Size</span>
                  <span style={{ width: 70, textAlign: "right" }}>Time</span>
                </div>
                {whales.map((w) => (
                  <WhaleRowItem key={w.id} whale={w} markets={markets} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
