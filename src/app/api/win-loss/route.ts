// ============================================================================
// PolyBot — Win/Loss Analytics API (Fix #41c — Supabase trades table)
// GET /api/win-loss
// Queries trades table where outcome IS NOT NULL (same pattern as feed.ts L1218-1221)
// Fields used: outcome ("win"|"loss"), pnl, coin, created_at (all confirmed in feed.ts)
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
  const debug: Record<string, unknown> = { step: "init", source: "trades" };

  try {
    const sb = getServiceSupabase();

    // ── Debug: count all trades (any status) ──
    debug.step = "count-all-trades";
    const { count: allTradesCount } = await sb
      .from("trades")
      .select("*", { count: "exact", head: true });
    debug.allTradesCount = allTradesCount ?? 0;

    // ── Debug: count trades with outcome not null ──
    const { count: closedCount } = await sb
      .from("trades")
      .select("*", { count: "exact", head: true })
      .not("outcome", "is", null);
    debug.closedTradesCount = closedCount ?? 0;

    // ── Debug: count trades with status = closed ──
    const { count: statusClosedCount } = await sb
      .from("trades")
      .select("*", { count: "exact", head: true })
      .eq("status", "closed");
    debug.statusClosedCount = statusClosedCount ?? 0;

    // ── Main query: closed trades with outcome ──
    // Mirrors feed.ts L1218-1221 exactly
    debug.step = "query-trades";
    const { data: trades, error: tradeErr } = await sb
      .from("trades")
      .select("outcome, pnl, coin, created_at")
      .not("outcome", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);

    debug.tradeError = tradeErr?.message ?? null;
    debug.tradeRowCount = trades?.length ?? 0;

    if (trades && trades.length > 0) {
      debug.sampleRow = trades[0];
      debug.sampleRowKeys = Object.keys(trades[0]);
    }

    // ── If trades table has no closed rows, fallback to performance table ──
    if (!trades || trades.length === 0) {
      debug.step = "fallback-performance";

      const { data: perfRows, error: perfErr } = await sb
        .from("performance")
        .select("date, wins, losses, win_rate, trades_count, pnl_day")
        .order("date", { ascending: false })
        .limit(90);

      debug.perfError = perfErr?.message ?? null;
      debug.perfRowCount = perfRows?.length ?? 0;
      if (perfRows && perfRows.length > 0) {
        debug.perfSampleRow = perfRows[0];
      }

      // Aggregate from performance table
      let totalWins = 0;
      let totalLosses = 0;
      let netPnlCents = 0;
      const daily: DailyRecord[] = [];

      for (const row of perfRows ?? []) {
        const w = Number(row.wins ?? 0);
        const l = Number(row.losses ?? 0);
        const pnl = Number(row.pnl_day ?? 0);
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
      debug.step = "done-performance-fallback";

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
    }

    // ── Aggregate trades by date ──
    debug.step = "aggregate";
    let totalWins = 0;
    let totalLosses = 0;
    let netPnlCents = 0;
    const byDate: Record<string, { wins: number; losses: number }> = {};

    for (const t of trades) {
      const outcome = String(t.outcome);
      const pnl = Number(t.pnl ?? 0);
      const dateStr = String(t.created_at ?? "").slice(0, 10); // YYYY-MM-DD

      if (outcome === "win") {
        totalWins++;
        if (!byDate[dateStr]) byDate[dateStr] = { wins: 0, losses: 0 };
        byDate[dateStr].wins++;
      } else if (outcome === "loss") {
        totalLosses++;
        if (!byDate[dateStr]) byDate[dateStr] = { wins: 0, losses: 0 };
        byDate[dateStr].losses++;
      }

      netPnlCents += Math.round(pnl * 100);
    }

    // Sort dates descending, limit 90 days
    const daily: DailyRecord[] = Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 90)
      .map(([date, { wins, losses }]) => ({
        date,
        wins,
        losses,
        winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
      }));

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
