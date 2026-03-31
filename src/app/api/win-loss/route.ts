// ============================================================================
// PolyBot — Win/Loss Analytics API (Fix #41 debug)
// GET /api/win-loss
// Returns daily win/loss breakdowns from Kalshi settled positions
// Falls back to Supabase trades table if Kalshi returns no data
// Edge runtime compatible
// ============================================================================

import { kalshiFetch } from "@/lib/kalshi";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "edge";

/** Month abbreviation → zero-indexed month number */
const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parse a Kalshi ticker into a date string (YYYY-MM-DD).
 * Handles multiple ticker formats:
 *   Daily:  KXBTCD-31MAR2613-T67999.99  (DDMMMYYHR)
 *   15-min: KXBTC15M-31MAR26T1300-T71500
 *   Short:  KXBTCD-31MAR26-T67999 (no hour digits)
 */
function parseTickerDate(ticker: string): string | null {
  // 15-min: KXBTC15M-31MAR26T1300-T71500
  const m15 = ticker.match(/^KXBTC15M-(\d{2})(\w{3})(\d{2})T/i);
  if (m15) {
    const [, day, mon, yr] = m15;
    const monthIdx = MONTHS[mon.toUpperCase()];
    if (monthIdx === undefined) return null;
    const year = 2000 + parseInt(yr, 10);
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${day}`;
  }

  // Daily with hour: KXBTCD-31MAR2613-T67999 (DDMMMYYHR — last 2 digits = hour)
  const mDH = ticker.match(/^KX\w+-(\d{2})(\w{3})(\d{2})\d{2}-T/i);
  if (mDH) {
    const [, day, mon, yr] = mDH;
    const monthIdx = MONTHS[mon.toUpperCase()];
    if (monthIdx === undefined) return null;
    const year = 2000 + parseInt(yr, 10);
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${day}`;
  }

  // Daily without hour: KXBTCD-31MAR26-T67999 (DDMMMYY only)
  const mD = ticker.match(/^KX\w+-(\d{2})(\w{3})(\d{2})-T/i);
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
  const debug: Record<string, unknown> = { step: "init", source: "none" };

  try {
    const apiKey = process.env.KALSHI_API_KEY;
    const privateKey = process.env.KALSHI_PRIVATE_KEY;

    debug.hasApiKey = !!apiKey;
    debug.hasPrivateKey = !!privateKey;

    let totalWins = 0;
    let totalLosses = 0;
    let netPnlCents = 0;
    const dailyMap = new Map<string, { wins: number; losses: number }>();

    // ── ATTEMPT 1: Kalshi settled positions ──
    if (apiKey && privateKey) {
      try {
        debug.step = "kalshi-fetch";
        const resp = await kalshiFetch<Record<string, unknown>>({
          method: "GET",
          path: "/portfolio/positions?settlement_status=settled&limit=200",
          apiKey,
          privateKey,
        });

        debug.kalshiRawKeys = Object.keys(resp);
        const settled = (resp.market_positions ?? resp.settlements ?? []) as Record<string, unknown>[];
        debug.kalshiSettledCount = settled.length;

        // Log first position for debugging field names
        if (settled.length > 0) {
          debug.samplePosition = settled[0];
          debug.samplePositionKeys = Object.keys(settled[0]);
        }

        // Filter to real trades (non-zero pnl or actually traded)
        const realSettled = settled.filter((p) => {
          const pnl = Number(p.realized_pnl ?? 0);
          const totalTraded = Number(p.total_traded ?? 0);
          return pnl !== 0 || totalTraded > 0;
        });

        debug.kalshiRealSettledCount = realSettled.length;

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

        if (realSettled.length > 0) {
          debug.source = "kalshi";
        }
      } catch (kalshiErr) {
        debug.kalshiError = kalshiErr instanceof Error ? kalshiErr.message : String(kalshiErr);
      }
    }

    // ── ATTEMPT 2: Supabase fallback if Kalshi returned nothing ──
    if (totalWins + totalLosses === 0) {
      try {
        debug.step = "supabase-fallback";
        const { data: trades, error: sbErr } = await getServiceSupabase()
          .from("trades")
          .select("pnl, entry_at, status, direction")
          .neq("status", "open")
          .order("entry_at", { ascending: false })
          .limit(500);

        debug.supabaseError = sbErr?.message ?? null;
        debug.supabaseTradeCount = trades?.length ?? 0;

        if (trades && trades.length > 0) {
          debug.sampleTrade = trades[0];
          debug.source = "supabase";

          for (const t of trades) {
            const pnl = Number(t.pnl ?? 0);
            const isWin = pnl > 0;
            const isLoss = pnl < 0;

            // Skip trades with no pnl data (still open or unknown)
            if (pnl === 0 && t.status === "open") continue;

            if (isWin) totalWins++;
            else if (isLoss) totalLosses++;
            else totalWins++; // breakeven = win
            netPnlCents += Math.round(pnl * 100);

            // Group by date
            const entryAt = String(t.entry_at ?? "");
            const date = entryAt.slice(0, 10) || "unknown"; // YYYY-MM-DD
            const day = dailyMap.get(date) ?? { wins: 0, losses: 0 };
            if (isLoss) day.losses++;
            else day.wins++;
            dailyMap.set(date, day);
          }
        }
      } catch (sbErr) {
        debug.supabaseFetchError = sbErr instanceof Error ? sbErr.message : String(sbErr);
      }
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
