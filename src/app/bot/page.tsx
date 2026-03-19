"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  MarketRow,
  SignalRow,
  TradeRow,
  PerformanceRow,
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
  side: string;
  size: number;
  price: number;
  detected_at: string;
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

function SignalCard({ signal }: { signal: SignalRow }) {
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
          <p style={{ fontSize: 13, color: css.textPrimary, fontWeight: 500 }}>
            {signal.strategy}
          </p>
          <p style={{ fontSize: 11, color: css.textSecondary, marginTop: 2 }}>
            {fmtTime(signal.created_at)}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            {signal.strategy}
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
// Whale Row
// ---------------------------------------------------------------------------

function WhaleRow({ whale }: { whale: WhaleRow }) {
  const dirColor = whale.side === "yes" || whale.side === "YES" ? "#4ade80" : "#f87171";
  const dirBg = whale.side === "yes" || whale.side === "YES"
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
      <p style={{ fontSize: 13, color: css.textPrimary, flex: 1, minWidth: 0 }}>
        {whale.market_id.slice(0, 8)}...
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
        {whale.side.toUpperCase()}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: css.textPrimary, fontFamily: "monospace", width: 80, textAlign: "right" }}>
        {fmtK(whale.size)}
      </span>
      <span style={{ fontSize: 11, color: css.textSecondary, width: 70, textAlign: "right" }}>
        {timeAgo(whale.detected_at)}
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

  // Track which markets we've already sent to swarm (avoid duplicate calls)
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());

  // Fetch markets + whales (every 30s)
  const loadMarkets = useCallback(async () => {
    try {
      const data = await fetchMarkets();
      setMarkets(data.markets);
      setWhales(data.whales);
      setConnected(data.connected);

      // For each NEW market, call swarm to get AI signal
      const newMarkets = data.markets.filter((m) => !analyzedIds.has(m.id));
      if (newMarkets.length > 0) {
        const newIds = new Set(analyzedIds);
        const signalPromises = newMarkets.slice(0, 3).map(async (m) => {
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
          setSignals((prev) => [...newSignals, ...prev].slice(0, 30));
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

  useEffect(() => {
    loadMarkets();
    loadBtc();
    const dashInterval = setInterval(loadMarkets, 30_000);
    const btcInterval = setInterval(loadBtc, 5_000);
    return () => {
      clearInterval(dashInterval);
      clearInterval(btcInterval);
    };
  }, [loadMarkets, loadBtc]);

  const perf: PerformanceRow | null = null; // Performance comes from a separate table — will be wired later

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
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 500,
              padding: "3px 10px",
              borderRadius: 6,
              background: "rgba(74,222,128,0.1)",
              color: "#4ade80",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
            Paper trade
          </span>
        </div>
        <button
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "6px 16px",
            borderRadius: 6,
            border: "1px solid #f87171",
            background: "rgba(248,113,113,0.1)",
            color: "#f87171",
            cursor: "pointer",
          }}
        >
          Kill switch
        </button>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>
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

        {/* ── 4 STAT CARDS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          <StatCard
            label="Total P&L"
            value={fmt$(perf?.pnl_cumulative ?? 0)}
            color={pnlColor(perf?.pnl_cumulative ?? 0)}
          />
          <StatCard
            label="Win Rate"
            value={fmtPct(perf?.win_rate ?? 0)}
          />
          <StatCard
            label="Signals Today"
            value={String(signals.length)}
          />
          <StatCard
            label="USDC Rebates"
            value={fmt$(perf?.rebates_earned ?? 0)}
          />
        </div>

        {/* ── MAIN 2-COLUMN GRID ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* LEFT — BTC 5-Min */}
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              BTC 5-Min Live
            </p>
            <Btc5MinPanel data={btc} />
          </div>

          {/* RIGHT — Live Signals */}
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Live Signals ({signals.length})
              {connected && <span style={{ color: "#4ade80", marginLeft: 8, fontSize: 10 }}>WS CONNECTED</span>}
            </p>
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {signals.length === 0 ? (
                <Card>
                  <p style={{ color: css.textSecondary, textAlign: "center", padding: 24, fontSize: 13 }}>
                    {markets.length > 0 ? "Analyzing markets..." : "No signals yet"}
                  </p>
                </Card>
              ) : (
                signals.map((s) => (
                  <SignalCard key={s.id} signal={s} />
                ))
              )}
            </div>
          </div>
        </div>

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
                  <WhaleRow key={w.id} whale={w} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
