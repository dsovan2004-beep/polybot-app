"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ---------------------------------------------------------------------------
// Styling constants — match dashboard theme
// ---------------------------------------------------------------------------

const css = {
  bgCard: "var(--color-background-primary, #1e293b)",
  border: "var(--color-border-tertiary, rgba(148,163,184,0.15))",
  textPrimary: "var(--color-text-primary, #f8fafc)",
  textSecondary: "var(--color-text-secondary, #94a3b8)",
  radius: "var(--border-radius-lg, 12px)",
};

const GREEN = "#4ade80";
const RED = "#f87171";
const BLUE = "#60a5fa";
const YELLOW = "#fbbf24";

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface DailyRecord {
  date: string;
  wins: number;
  losses: number;
  winRate: number;
}

interface WinLossData {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  daily: DailyRecord[];
}

// ---------------------------------------------------------------------------
// Card component (matches dashboard)
// ---------------------------------------------------------------------------

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
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

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
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
// Custom tooltip for charts
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1e293b",
      border: `1px solid ${css.border}`,
      borderRadius: 8,
      padding: "8px 12px",
      fontSize: 12,
    }}>
      <p style={{ color: css.textSecondary, marginBottom: 4 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {typeof p.value === "number" && p.name === "Win Rate" ? `${p.value.toFixed(1)}%` : p.value}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Format date for display: "2026-03-26" → "Mar 26"
// ---------------------------------------------------------------------------

function fmtDate(d: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parts = d.split("-");
  if (parts.length < 3) return d;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${months[monthIdx] ?? parts[1]} ${day}`;
}

// ---------------------------------------------------------------------------
// Win rate color
// ---------------------------------------------------------------------------

function wrColor(rate: number): string {
  if (rate >= 85) return GREEN;
  if (rate >= 75) return YELLOW;
  return RED;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function WinLossAnalytics() {
  const [data, setData] = useState<WinLossData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/win-loss");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed");
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000); // refresh every 60s
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Win/Loss Analytics
        </p>
        <Card>
          <p style={{ color: css.textSecondary, textAlign: "center", padding: 24, fontSize: 13 }}>
            Loading analytics...
          </p>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Win/Loss Analytics
        </p>
        <Card>
          <p style={{ color: RED, textAlign: "center", padding: 24, fontSize: 13 }}>
            {error ?? "No data available"}
          </p>
        </Card>
      </div>
    );
  }

  // Chart data: last 14 days, sorted oldest→newest for charts
  const chartData = data.daily
    .slice(0, 14)
    .reverse()
    .map((d) => ({
      date: fmtDate(d.date),
      Wins: d.wins,
      Losses: d.losses,
      "Win Rate": Math.round(d.winRate * 1000) / 10,
    }));

  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        Win/Loss Analytics
      </p>

      {/* ── PART 1: Stat Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="Total Trades" value={String(data.totalTrades)} />
        <StatCard label="Wins (NO)" value={String(data.wins)} color={GREEN} />
        <StatCard label="Losses" value={String(data.losses)} color={RED} />
        <StatCard
          label="Win Rate"
          value={`${data.winRate.toFixed(1)}%`}
          color={wrColor(data.winRate)}
        />
      </div>

      {/* ── PART 2: Bar Chart — Daily Wins vs Losses ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Card>
          <p style={{ fontSize: 11, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
            Daily Wins vs Losses (Last 14 Days)
          </p>
          {chartData.length === 0 ? (
            <p style={{ color: css.textSecondary, textAlign: "center", padding: 24, fontSize: 13 }}>
              No daily data yet
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="Wins" fill={GREEN} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Losses" fill={RED} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* ── PART 3: Line Chart — Win Rate by Day ── */}
        <Card>
          <p style={{ fontSize: 11, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
            Win Rate Trend (Last 14 Days)
          </p>
          {chartData.length === 0 ? (
            <p style={{ color: css.textSecondary, textAlign: "center", padding: 24, fontSize: 13 }}>
              No daily data yet
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="Win Rate"
                  stroke={BLUE}
                  strokeWidth={2}
                  dot={{ fill: BLUE, r: 4 }}
                  activeDot={{ r: 6, fill: BLUE }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* ── PART 4: Breakdown Table ── */}
      <Card>
        <p style={{ fontSize: 11, color: css.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
          Daily Breakdown
        </p>
        {data.daily.length === 0 ? (
          <p style={{ color: css.textSecondary, textAlign: "center", padding: 24, fontSize: 13 }}>
            No trade history yet
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Wins", "Losses", "Win Rate"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === "Date" ? "left" : "right",
                      padding: "6px 10px",
                      fontSize: 11,
                      color: css.textSecondary,
                      fontWeight: 500,
                      borderBottom: `0.5px solid ${css.border}`,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.daily.map((row) => {
                const wr = Math.round(row.winRate * 1000) / 10;
                return (
                  <tr key={row.date} style={{ borderBottom: `0.5px solid ${css.border}` }}>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: css.textPrimary }}>
                      {fmtDate(row.date)}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: GREEN, fontFamily: "monospace", textAlign: "right", fontWeight: 600 }}>
                      {row.wins}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: RED, fontFamily: "monospace", textAlign: "right", fontWeight: 600 }}>
                      {row.losses}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: wrColor(wr), fontFamily: "monospace", textAlign: "right", fontWeight: 600 }}>
                      {wr.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
