// ============================================================================
// PolyBot — Stats API (Sprint 11 / Fix #8)
// GET /api/stats
// Returns real P&L from Kalshi settled positions (not Supabase)
// Edge runtime compatible
// ============================================================================

import { kalshiFetch } from "@/lib/kalshi";

export const runtime = "edge";

/**
 * Parse a Kalshi ticker into a human-readable title.
 * e.g. "KXBTCD-26MAR25-T72000" → "BTC >$72,000 · Mar 26"
 */
function parseTickerTitle(ticker: string): string {
  // Handle KXBTC15M differently: KXBTC15M-26MAR25T1300-T71500
  const match15m = ticker.match(
    /^KXBTC15M-(\d{2})(\w{3})\d{2}T(\d{2})(\d{2})-T([\d.]+)$/i
  );
  if (match15m) {
    const [, day, month, hour, minute, threshold] = match15m;
    const t = parseFloat(threshold);
    const ts = t >= 1000 ? `$${t.toLocaleString()}` : `$${threshold}`;
    return `BTC 15m >${ts} · ${month} ${day} ${hour}:${minute}`;
  }

  // Standard daily: KXBTCD-26MAR25-T72000
  const match = ticker.match(
    /^(KX\w+?D)-(\d{2})(\w{3})\d{2}-T([\d.]+)$/i
  );
  if (match) {
    const [, series, day, month, threshold] = match;
    const coinMap: Record<string, string> = {
      KXBTCD: "BTC",
      KXETHD: "ETH",
      KXSOLD: "SOL",
      KXXRPD: "XRP",
      KXDOGED: "DOGE",
      KXBNBD: "BNB",
    };
    const coin = coinMap[series.toUpperCase()] ?? series;
    const t = parseFloat(threshold);
    const ts = t >= 1000 ? `$${t.toLocaleString()}` : `$${threshold}`;
    return `${coin} >${ts} · ${month} ${day}`;
  }

  return ticker;
}

export async function GET() {
  try {
    const apiKey = process.env.KALSHI_API_KEY;
    const privateKey = process.env.KALSHI_PRIVATE_KEY;

    if (!apiKey || !privateKey) {
      return Response.json({
        ok: true,
        data: {
          totalTrades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          netPnl: 0,
          recentTrades: [],
        },
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

    let wins = 0;
    let losses = 0;
    let netPnlCents = 0;

    // Filter out zero-exposure settled positions (settled but not truly traded)
    const realSettled = settled.filter((p) => {
      const pnl = Number(p.realized_pnl ?? 0);
      const totalTraded = Number(p.total_traded ?? 0);
      return pnl !== 0 || totalTraded > 0;
    });

    const trades = realSettled.map((p) => {
      const pnl = Number(p.realized_pnl ?? 0); // cents
      netPnlCents += pnl;

      // Determine win/loss from realized_pnl:
      //   positive pnl = WIN (we made money)
      //   negative pnl = LOSS (we lost money)
      //   zero pnl with trades = breakeven (count as win — we got our money back)
      const isWin = pnl >= 0;
      if (isWin) wins++;
      else losses++;

      const positionFp = parseFloat(String(p.position_fp ?? "0"));
      const side = positionFp < 0 ? "NO" : positionFp > 0 ? "YES" : "—";
      const ticker = String(p.ticker ?? "");
      const title = parseTickerTitle(ticker);

      return {
        ticker,
        title,
        side,
        result: isWin ? "WIN" : "LOSS",
        pnl: Math.round(pnl) / 100, // cents → dollars
      };
    });

    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;

    // Return last 10 trades (most recent first)
    const recentTrades = trades.slice(-10).reverse();

    return Response.json({
      ok: true,
      data: {
        totalTrades,
        wins,
        losses,
        winRate: Math.round(winRate * 1000) / 1000,
        netPnl: Math.round(netPnlCents) / 100,
        recentTrades,
      },
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
