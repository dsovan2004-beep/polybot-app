"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  MarketRow,
  SignalRow,
  TradeRow,
  PerformanceRow,
  RebateRow,
} from "@/lib/supabase";

// ============================================================================
// PolyBot Dashboard — /bot  (Sprint 2)
// Fetches from GET /api/markets which returns Sprint 2 Supabase data
// ============================================================================

// ---------------------------------------------------------------------------
// Dashboard response shape (matches /api/markets GET)
// ---------------------------------------------------------------------------

interface DashboardData {
  markets: MarketRow[];
  signals: SignalRow[];
  openTrades: TradeRow[];
  recentTrades: TradeRow[];
  performance: PerformanceRow | null;
  rebates: RebateRow[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchDashboard(category?: string): Promise<DashboardData> {
  const url = category
    ? `/api/markets?category=${category}`
    : "/api/markets";
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Failed to load dashboard");
  return json.data;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt$(n: number | null): string {
  if (n === null || n === undefined) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "0.0%";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function pnlColor(n: number | null): string {
  if (n === null) return "text-slate-400";
  if (n > 0) return "text-green-400";
  if (n < 0) return "text-red-400";
  return "text-slate-400";
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? "text-white"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function PerformanceGrid({ perf }: { perf: PerformanceRow }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        label="P&L Today"
        value={fmt$(perf.pnl_day)}
        color={pnlColor(perf.pnl_day)}
      />
      <StatCard
        label="P&L Cumulative"
        value={fmt$(perf.pnl_cumulative)}
        color={pnlColor(perf.pnl_cumulative)}
      />
      <StatCard
        label="Win Rate"
        value={fmtPct(perf.win_rate)}
        sub={`${perf.trades_count} trades (${perf.wins}W / ${perf.losses}L)`}
      />
      <StatCard
        label="Balance"
        value={fmt$(perf.ending_balance)}
        sub={`Started: ${fmt$(perf.starting_balance)}`}
      />
      <StatCard
        label="Rebates"
        value={fmt$(perf.rebates_earned)}
      />
      <StatCard
        label="Drawdown"
        value={fmtPct(perf.drawdown_pct)}
        color={
          (perf.drawdown_pct ?? 0) > 0.15 ? "text-red-400" : "text-slate-300"
        }
        sub={perf.kill_switch ? "KILL SWITCH ACTIVE" : undefined}
      />
    </div>
  );
}

function SignalRow({ signal }: { signal: SignalRow }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">
          {signal.strategy}
        </p>
        <p className="text-xs text-slate-500">
          Claude: {signal.claude_vote ?? "—"} · Consensus: {signal.consensus ?? "—"}
        </p>
      </div>
      <div className="flex items-center gap-3 ml-3">
        {signal.consensus && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded ${
              signal.consensus === "YES"
                ? "bg-green-500/15 text-green-400"
                : signal.consensus === "NO"
                ? "bg-red-500/15 text-red-400"
                : "bg-slate-500/15 text-slate-400"
            }`}
          >
            {signal.consensus}
          </span>
        )}
        <span
          className={`text-sm font-mono ${
            (signal.confidence ?? 0) >= 67 ? "text-green-400" : "text-amber-400"
          }`}
        >
          {signal.confidence ?? 0}%
        </span>
        <span className="text-xs text-slate-500">
          Gap: {fmtPct(signal.price_gap)}
        </span>
        <span className="text-xs text-slate-600">
          {fmtTime(signal.created_at)}
        </span>
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: TradeRow }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">
          {trade.strategy ?? "—"}
        </p>
        <p className="text-xs text-slate-500">
          {trade.status} · {trade.hold_hours ? `${trade.hold_hours}h` : "open"}
        </p>
      </div>
      <div className="flex items-center gap-3 ml-3">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${
            trade.direction === "YES"
              ? "bg-green-500/15 text-green-400"
              : "bg-red-500/15 text-red-400"
          }`}
        >
          {trade.direction}
        </span>
        <span className="text-sm font-mono text-slate-300">
          {fmt$(trade.entry_cost)}
        </span>
        {trade.pnl !== null && (
          <span className={`text-sm font-mono ${pnlColor(trade.pnl)}`}>
            {fmt$(trade.pnl)}
          </span>
        )}
        <span className="text-xs text-slate-600">
          {fmtTime(trade.entry_at)}
        </span>
      </div>
    </div>
  );
}

function MarketRow({ market }: { market: MarketRow }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{market.title}</p>
        <p className="text-xs text-slate-500">
          {market.category} · Vol: {fmt$(market.volume_24h)}
        </p>
      </div>
      <div className="flex items-center gap-3 ml-3">
        <span className="text-sm font-mono text-white">
          {fmtPct(market.current_price)}
        </span>
        <span className="text-xs text-slate-500">
          Liq: {fmt$(market.liquidity)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BotDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const d = await fetchDashboard(category);
      setData(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5_000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <main className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">PolyBot</h1>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-xs text-amber-400">
              Paper Trade
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Category filter */}
            <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs">
              <button
                onClick={() => setCategory(undefined)}
                className={`px-3 py-1.5 transition-colors ${
                  !category
                    ? "bg-blue-500/20 text-blue-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setCategory("ai_tech")}
                className={`px-3 py-1.5 transition-colors ${
                  category === "ai_tech"
                    ? "bg-blue-500/20 text-blue-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                AI/Tech
              </button>
              <button
                onClick={() => setCategory("politics")}
                className={`px-3 py-1.5 transition-colors ${
                  category === "politics"
                    ? "bg-blue-500/20 text-blue-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Politics
              </button>
            </div>
            <span className="text-xs text-slate-600">
              {data ? `Updated ${fmtTime(data.updatedAt)}` : ""}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-2 text-slate-500">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
              </span>
              Loading dashboard...
            </div>
          </div>
        )}

        {data && (
          <>
            {/* Kill switch warning */}
            {data.performance?.kill_switch && (
              <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400 font-medium flex items-center gap-2">
                KILL SWITCH ACTIVE — drawdown exceeded 20% in 24h. All trading halted.
              </div>
            )}

            {/* Performance */}
            {data.performance && (
              <section>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Performance — {fmtDate(data.performance.date)}
                </h2>
                <PerformanceGrid perf={data.performance} />
              </section>
            )}

            {/* Signals + Markets */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Signals */}
              <section className="lg:col-span-2">
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Recent Signals ({data.signals.length})
                </h2>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 max-h-96 overflow-y-auto">
                  {data.signals.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-4">
                      No signals yet
                    </p>
                  ) : (
                    data.signals.map((s) => (
                      <SignalRow key={s.id} signal={s} />
                    ))
                  )}
                </div>
              </section>

              {/* Markets */}
              <section>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Markets ({data.markets.length})
                </h2>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 max-h-96 overflow-y-auto">
                  {data.markets.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-4">
                      No markets tracked
                    </p>
                  ) : (
                    data.markets.map((m) => (
                      <MarketRow key={m.id} market={m} />
                    ))
                  )}
                </div>
              </section>
            </div>

            {/* Open Trades + Recent Trades */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Open Trades ({data.openTrades.length})
                </h2>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 max-h-80 overflow-y-auto">
                  {data.openTrades.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-4">
                      No open trades
                    </p>
                  ) : (
                    data.openTrades.map((t) => (
                      <TradeRow key={t.id} trade={t} />
                    ))
                  )}
                </div>
              </section>

              <section>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Recent Trades
                </h2>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 max-h-80 overflow-y-auto">
                  {data.recentTrades.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-4">
                      No trades yet
                    </p>
                  ) : (
                    data.recentTrades.map((t) => (
                      <TradeRow key={t.id} trade={t} />
                    ))
                  )}
                </div>
              </section>
            </div>

            {/* Rebates */}
            {data.rebates.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  USDC Rebates
                </h2>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4">
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                    {data.rebates.slice(0, 6).map((r) => (
                      <div key={r.id} className="text-center">
                        <p className="text-xs text-slate-500">{fmtDate(r.date)}</p>
                        <p className="text-sm font-mono text-green-400">
                          {fmt$(r.usdc_earned)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
