"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  DashboardData,
  Trade,
  WhaleAlert,
  Performance,
  BotStatus,
  TradingMode,
  Signal,
  SwarmResult,
} from "@/lib/types";

// ============================================================================
// PolyBot Dashboard — /bot
// Real-time trading dashboard with performance, signals, whale alerts, swarm
// ============================================================================

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchDashboard(mode: TradingMode): Promise<DashboardData> {
  const res = await fetch(`/api/markets?mode=${mode}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Failed to load dashboard");
  return json.data;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt$(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusColor(status: BotStatus): string {
  const map: Record<BotStatus, string> = {
    idle: "text-slate-400",
    running: "text-green-400",
    paused: "text-amber-400",
    killed: "text-red-500",
    error: "text-red-400",
  };
  return map[status] ?? "text-slate-400";
}

function pnlColor(n: number): string {
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

function PerformanceGrid({ perf }: { perf: Performance }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        label="Total P&L"
        value={fmt$(perf.totalPnl)}
        color={pnlColor(perf.totalPnl)}
      />
      <StatCard
        label="Win Rate"
        value={fmtPct(perf.winRate)}
        sub={`${perf.totalTrades} trades`}
      />
      <StatCard
        label="Avg Confidence"
        value={fmtPct(perf.avgConfidence)}
        color={perf.avgConfidence >= 0.67 ? "text-green-400" : "text-amber-400"}
      />
      <StatCard label="Volume" value={fmt$(perf.totalVolume)} />
      <StatCard
        label="Realized P&L"
        value={fmt$(perf.realizedPnl)}
        color={pnlColor(perf.realizedPnl)}
      />
      <StatCard
        label="Unrealized P&L"
        value={fmt$(perf.unrealizedPnl)}
        color={pnlColor(perf.unrealizedPnl)}
      />
      <StatCard label="Rebates" value={fmt$(perf.totalRebates)} />
      <StatCard
        label="Drawdown 24h"
        value={fmtPct(perf.drawdownPercent24h / 100)}
        color={perf.drawdownPercent24h > 15 ? "text-red-400" : "text-slate-300"}
        sub={perf.killSwitchTriggered ? "KILL SWITCH ACTIVE" : undefined}
      />
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{signal.marketId}</p>
        <p className="text-xs text-slate-500">
          {signal.strategyName} · {signal.aiProvider}
        </p>
      </div>
      <div className="flex items-center gap-3 ml-3">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${
            signal.side === "yes"
              ? "bg-green-500/15 text-green-400"
              : "bg-red-500/15 text-red-400"
          }`}
        >
          {signal.side.toUpperCase()}
        </span>
        <span
          className={`text-sm font-mono ${
            signal.confidence >= 0.67 ? "text-green-400" : "text-amber-400"
          }`}
        >
          {fmtPct(signal.confidence)}
        </span>
        <span className="text-xs text-slate-600">{fmtTime(signal.createdAt)}</span>
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{trade.marketId}</p>
        <p className="text-xs text-slate-500">
          {trade.strategyName} · {trade.status}
        </p>
      </div>
      <div className="flex items-center gap-3 ml-3">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${
            trade.side === "yes"
              ? "bg-green-500/15 text-green-400"
              : "bg-red-500/15 text-red-400"
          }`}
        >
          {trade.side.toUpperCase()}
        </span>
        <span className="text-sm font-mono text-slate-300">
          {fmt$(trade.price * trade.size)}
        </span>
        {trade.pnl !== null && (
          <span className={`text-sm font-mono ${pnlColor(trade.pnl)}`}>
            {fmt$(trade.pnl)}
          </span>
        )}
        <span className="text-xs text-slate-600">
          {fmtTime(trade.createdAt)}
        </span>
      </div>
    </div>
  );
}

function WhaleAlertRow({ alert }: { alert: WhaleAlert }) {
  const sevColor: Record<string, string> = {
    low: "bg-slate-500/15 text-slate-400",
    medium: "bg-amber-500/15 text-amber-400",
    high: "bg-red-500/15 text-red-400",
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white">{alert.message}</p>
        <p className="text-xs text-slate-500">{alert.alertType}</p>
      </div>
      <div className="flex items-center gap-2 ml-3">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${
            sevColor[alert.severity] ?? sevColor.low
          }`}
        >
          {alert.severity.toUpperCase()}
        </span>
        <span className="text-xs text-slate-600">
          {fmtTime(alert.createdAt)}
        </span>
      </div>
    </div>
  );
}

function SwarmCard({ result }: { result: SwarmResult }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Latest Swarm</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded font-medium ${
            result.consensusReached
              ? "bg-green-500/15 text-green-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
        >
          {result.consensusReached ? "CONSENSUS" : "NO CONSENSUS"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-green-400">{result.yesVotes}</p>
          <p className="text-xs text-slate-500">YES</p>
        </div>
        <div>
          <p className="text-lg font-bold text-red-400">{result.noVotes}</p>
          <p className="text-xs text-slate-500">NO</p>
        </div>
        <div>
          <p className="text-lg font-bold text-white">
            {fmtPct(result.avgConfidence)}
          </p>
          <p className="text-xs text-slate-500">AVG CONF</p>
        </div>
      </div>
      {result.consensusSide && (
        <p className="text-xs text-slate-400 mt-3 text-center">
          Consensus: <span className="text-white font-medium">{result.consensusSide.toUpperCase()}</span> at{" "}
          <span className="text-white font-medium">{fmtPct(result.consensusConfidence ?? 0)}</span>
        </p>
      )}
      {result.dissent.length > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          <p className="font-medium text-slate-400 mb-1">Dissent:</p>
          {result.dissent.map((d, i) => (
            <p key={i} className="truncate">
              {d}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BotDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [mode, setMode] = useState<TradingMode>("paper");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const d = await fetchDashboard(mode);
      setData(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5_000); // refresh every 5s
    return () => clearInterval(interval);
  }, [loadData]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">PolyBot</h1>
            {data && (
              <span
                className={`flex items-center gap-1.5 text-xs font-medium ${statusColor(
                  data.botStatus
                )}`}
              >
                <span className="relative flex h-2 w-2">
                  {data.botStatus === "running" && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      data.botStatus === "running"
                        ? "bg-green-400"
                        : data.botStatus === "killed"
                        ? "bg-red-500"
                        : "bg-slate-500"
                    }`}
                  />
                </span>
                {data.botStatus.toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs">
              <button
                onClick={() => setMode("paper")}
                className={`px-3 py-1.5 transition-colors ${
                  mode === "paper"
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Paper
              </button>
              <button
                onClick={() => setMode("live")}
                className={`px-3 py-1.5 transition-colors ${
                  mode === "live"
                    ? "bg-green-500/20 text-green-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Live
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
            {data.performance.killSwitchTriggered && (
              <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400 font-medium flex items-center gap-2">
                <span className="text-lg">⚠</span>
                Kill switch triggered — drawdown exceeded 20% in 24h. All trading halted.
              </div>
            )}

            {/* Performance */}
            <section>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Performance
              </h2>
              <PerformanceGrid perf={data.performance} />
            </section>

            {/* Two-column: Signals + Swarm */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Signals */}
              <section className="lg:col-span-2">
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Recent Signals
                </h2>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4">
                  {data.recentSignals.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-4">
                      No signals yet
                    </p>
                  ) : (
                    data.recentSignals.map((s) => (
                      <SignalRow key={s.id} signal={s} />
                    ))
                  )}
                </div>
              </section>

              {/* Swarm */}
              <section>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  AI Swarm
                </h2>
                {data.lastSwarmResult ? (
                  <SwarmCard result={data.lastSwarmResult} />
                ) : (
                  <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 text-sm text-slate-600 text-center py-8">
                    No swarm results yet
                  </div>
                )}
              </section>
            </div>

            {/* Two-column: Positions + Whale Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Positions / Trades */}
              <section>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Open Positions ({data.positions.length})
                </h2>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4">
                  {data.positions.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-4">
                      No open positions
                    </p>
                  ) : (
                    data.positions.map((t) => (
                      <TradeRow key={t.id} trade={t} />
                    ))
                  )}
                </div>
              </section>

              {/* Whale Alerts */}
              <section>
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Whale Alerts
                </h2>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-4">
                  {data.whaleAlerts.length === 0 ? (
                    <p className="text-sm text-slate-600 text-center py-4">
                      No whale activity
                    </p>
                  ) : (
                    data.whaleAlerts.map((a) => (
                      <WhaleAlertRow key={a.id} alert={a} />
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
