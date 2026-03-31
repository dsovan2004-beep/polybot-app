// ============================================================================
// PolyBot — Win/Loss Analytics API
// GET /api/win-loss
// Returns daily win/loss breakdowns from Kalshi settled positions
// Edge runtime compatible
// ============================================================================

import { kalshiFetch } from "@/lib/kalshi";

export const runtime = "edge";

/** Month abbreviation → zero-indexed month number */
const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parse a Kalshi ticker into a date string (YYYY-MM-DD).
 * e.g. "KXBTCD-26MAR2613-T71199.99" → "2026-03-26"
 * e.g. "KXBTC15M-26MAR26T1300-T71500" → "2026-03-26"
 */
function parseTickerDate(ticker: string): string | null {
  // 15-min: KXBTC15M-26MAR26T1300-T71500
  const m15 = ticker.match(/^KXBTC15M-(\d{2})(\w{3})(\d{2})T/i);
  if (m15) {
    const [, day, mon, yr] = m15;
    const monthIdx = MONTHS[mon.toUpperCase()];
    if (monthIdx === undefined) return null;
    const year = 2000 + parseInt(yr, 10);
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${day}`;
  }

  // Daily: KXBTCD-26MAR2613-T71199.99 (DDMMMYYHR)
  const mD = ticker.match(/^KX\w+-(\d{2})(\w{3})(\d{2})\d{2}-T/i);
  if (mD) {
    const [, day, mon, yr] = mD;
    const monthIdx = MONTHS[mon.toUpperCase()];
    if (monthIdx === undefined) return null;
    const year = 2000 + parseInt(yr, 10);
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${day}`;
  }

  return null;
}

interface DailyRecord {
  date: string;
  wins: number;
  losses: number;
  winRate: number;
}

export async function GET() {
  try {
    const apiKey = process.env.KALSHI_API_KEY;
    const privateKey = process.env.KALSHI_PRIVATE_KEY;

    if (!apiKey || !privateKey) {
      return Response.json({
        ok: true,
        data: { totalTrades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0, daily: [] },
      });
    }

    // Fetch settled positions from Kalshi
    const resp = await kalshiFetch<{
      market_positions: Record<string, unknown>[];
    }>({
      method: "GET",
      path: "/portfolio/positions?settlement_status=settled&limit=200",
      apiKey,
      privateKey,
    });

    const settled = resp.market_positions ?? [];

    // Filter to real trades (non-zero pnl or actually traded)
    const realSettled = settled.filter((p) => {
      const pnl = Number(p.realized_pnl ?? 0);
      const totalTraded = Number(p.total_traded ?? 0);
      return pnl !== 0 || totalTraded > 0;
    });

    // Aggregate totals + daily breakdown
    let totalWins = 0;
    let totalLosses = 0;
    let netPnlCents = 0;
    const dailyMap = new Map<string, { wins: number; losses: number }>();

    for (const p of realSettled) {
      const pnl = Number(p.realized_pnl ?? 0);
      netPnlCents += pnl;
      const isWin = pnl >= 0;
      if (isWin) totalWins++;
      else totalLosses++;

      const ticker = String(p.ticker ?? "");
      const date = parseTickerDate(ticker) ?? "unknown";

      const day = dailyMap.get(date) ?? { wins: 0, losses: 0 };
      if (isWin) day.wins++;
      else day.losses++;
      dailyMap.set(date, day);
    }

    const totalTrades = totalWins + totalLosses;
    const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;

    // Convert to sorted array (newest first)
    const daily: DailyRecord[] = Array.from(dailyMap.entries())
      .filter(([d]) => d !== "unknown")
      .map(([date, { wins, losses }]) => ({
        date,
        wins,
        losses,
        winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return Response.json({
      ok: true,
      data: {
        totalTrades,
        wins: totalWins,
        losses: totalLosses,
        winRate: Math.round(winRate * 1000) / 10, // e.g. 75.4
        netPnl: Math.round(netPnlCents) / 100,
        daily,
      },
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
