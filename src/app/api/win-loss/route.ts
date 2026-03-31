// ============================================================================
// PolyBot — Win/Loss Analytics API (Fix #41c — Supabase only)
// GET /api/win-loss
// Returns daily win/loss breakdowns from Supabase performance table
// No Kalshi dependency — performance table written by feed.ts daily
// Edge runtime compatible
// ============================================================================

import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "edge";

interface DailyRecord {
  date: string;
  wins: number;
  losses: number;
  winRate: number;
}

export async function GET() {
  const debug: Record<string, unknown> = { step: "init", source: "performance" };

  try {
    debug.step = "supabase-performance";

    // Query performance table — has daily wins, losses, win_rate, trades_count, pnl_day
    // Written by feed.ts on each trade settlement
    const { data: perfRows, error: perfErr } = await getServiceSupabase()
      .from("performance")
      .select("date, wins, losses, win_rate, trades_count, pnl_day")
      .order("date", { ascending: false })
      .limit(90);

    debug.perfError = perfErr?.message ?? null;
    debug.perfRowCount = perfRows?.length ?? 0;

    if (perfErr || !perfRows || perfRows.length === 0) {
      debug.step = "no-data";
      return Response.json({
        ok: true,
        data: {
          totalTrades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          netPnl: 0,
          daily: [],
        },
        debug,
      });
    }

    // Log first row for debugging field names
    debug.sampleRow = perfRows[0];
    debug.sampleRowKeys = Object.keys(perfRows[0]);

    // Aggregate totals from daily records
    let totalWins = 0;
    let totalLosses = 0;
    let netPnlCents = 0;

    const daily: DailyRecord[] = [];

    for (const row of perfRows) {
      const w = Number(row.wins ?? 0);
      const l = Number(row.losses ?? 0);
      const pnl = Number(row.pnl_day ?? 0);

      // Skip days with no trades
      if (w + l === 0) continue;

      totalWins += w;
      totalLosses += l;
      netPnlCents += Math.round(pnl * 100);

      daily.push({
        date: String(row.date),
        wins: w,
        losses: l,
        winRate: w + l > 0 ? w / (w + l) : 0,
      });
    }

    const totalTrades = totalWins + totalLosses;
    const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;

    debug.step = "done";
    debug.totalTrades = totalTrades;

    return Response.json({
      ok: true,
      data: {
        totalTrades,
        wins: totalWins,
        losses: totalLosses,
        winRate: Math.round(winRate * 1000) / 10,
        netPnl: Math.round(netPnlCents) / 100,
        daily,
      },
      debug,
    });
  } catch (err) {
    debug.step = "caught-exception";
    debug.error = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error", debug },
      { status: 500 }
    );
  }
}
