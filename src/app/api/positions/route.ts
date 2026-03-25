// ============================================================================
// PolyBot — Positions API (Sprint 11 / Fix #8)
// GET /api/positions
// Returns portfolio summary + enriched open positions with verdicts
// Edge runtime compatible
// ============================================================================

import { kalshiFetch } from "@/lib/kalshi";

export const runtime = "edge";

/**
 * Parse a Kalshi ticker into a compact strike label.
 * e.g. "KXBTCD-26MAR2513-T71199.99" → "BTC $71,200 · 1pm ET"
 * e.g. "KXBTC15M-26MAR25T1300-T71500" → "BTC 15m $71,500 · 1:00pm ET"
 */
function parseTickerLabel(ticker: string): string | null {
  const coinMap: Record<string, string> = {
    KXBTCD: "BTC", KXETHD: "ETH", KXSOLD: "SOL",
    KXXRPD: "XRP", KXDOGED: "DOGE", KXBNBD: "BNB",
  };

  // 15-min BTC: KXBTC15M-26MAR25T1300-T71500
  const m15 = ticker.match(
    /^KXBTC15M-\d{2}\w{3}\d{2}T(\d{2})(\d{2})-T([\d.]+)$/i
  );
  if (m15) {
    const [, hr, mn, threshold] = m15;
    const t = parseFloat(threshold);
    const ts = t >= 1000 ? `$${Math.round(t).toLocaleString()}` : `$${Math.round(t)}`;
    const h = parseInt(hr, 10);
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `BTC 15m ${ts} · ${h12}:${mn}${ampm} ET`;
  }

  // Daily crypto: KXBTCD-26MAR2513-T71199.99
  // The date segment is DDMMMYYHR where last 2 digits = hour ET
  const mD = ticker.match(
    /^(KX\w+?D)-(\d{2})\w{3}\d{2}(\d{2})-T([\d.]+)$/i
  );
  if (mD) {
    const [, series, , hourStr, threshold] = mD;
    const coin = coinMap[series.toUpperCase()] ?? series;
    const t = parseFloat(threshold);
    const ts = t >= 1000 ? `$${Math.round(t).toLocaleString()}` : `$${Math.round(t)}`;
    const h = parseInt(hourStr, 10);
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${coin} ${ts} · ${h12}${ampm} ET`;
  }

  return null;
}

export async function GET() {
  try {
    const apiKey = process.env.KALSHI_API_KEY;
    const privateKey = process.env.KALSHI_PRIVATE_KEY;

    if (!apiKey || !privateKey) {
      return Response.json({
        ok: true,
        data: {
          portfolio: { portfolioValue: 0, cash: 0, positionsValue: 0 },
          positions: [],
        },
      });
    }

    // Fetch balance + all positions in parallel
    const [balResp, posResp] = await Promise.all([
      kalshiFetch<{ balance: number }>({
        method: "GET",
        path: "/portfolio/balance",
        apiKey,
        privateKey,
      }),
      kalshiFetch<{ market_positions: Record<string, unknown>[] }>({
        method: "GET",
        path: "/portfolio/positions",
        apiKey,
        privateKey,
      }),
    ]);

    const cashDollars = balResp.balance / 100; // Kalshi returns cents
    const rawPositions = posResp.market_positions ?? [];

    // Filter to truly open positions (exposure > 0)
    const openPositions = rawPositions.filter((p) => {
      const exposure = parseFloat(String(p.market_exposure_dollars ?? "0"));
      return exposure > 0;
    });

    // Enrich each position with market details + verdict
    const enriched = await Promise.all(
      openPositions.map(async (pos) => {
        const ticker = String(pos.ticker ?? "");
        const positionFp = parseFloat(String(pos.position_fp ?? "0"));
        const exposureDollars = parseFloat(
          String(pos.market_exposure_dollars ?? "0")
        );
        const contracts = Math.abs(positionFp);
        const side = positionFp < 0 ? "NO" : "YES";

        // Average cost per contract
        const avgCost = contracts > 0 ? exposureDollars / contracts : 0;

        // YES price at purchase time:
        //   NO trade: we paid (1 - yesPrice) per contract → yesAtPurchase = 1 - avgCost
        //   YES trade: we paid yesPrice per contract → yesAtPurchase = avgCost
        const boughtYesPct =
          side === "NO"
            ? Math.round((1 - avgCost) * 100)
            : Math.round(avgCost * 100);

        // Fetch market details for current price + close time
        // Use parsed ticker label (compact) instead of full Kalshi title
        let title = parseTickerLabel(ticker) ?? ticker;
        let nowYesPct = 50;
        let closeTime = "";

        try {
          const mktResp = await kalshiFetch<Record<string, unknown>>({
            method: "GET",
            path: `/markets/${encodeURIComponent(ticker)}`,
            apiKey: apiKey!,
            privateKey: privateKey!,
          });
          const mkt = (mktResp.market ?? mktResp) as Record<string, unknown>;
          // Only use Kalshi title as fallback if ticker couldn't be parsed
          if (!parseTickerLabel(ticker)) {
            title = String(mkt.title ?? mkt.subtitle ?? ticker);
          }

          // Get current YES ask price
          const yesAskDollars = mkt.yes_ask_dollars as number | undefined;
          if (yesAskDollars !== undefined && yesAskDollars > 0) {
            nowYesPct = Math.round(yesAskDollars * 100);
          } else {
            const yesAskCents = mkt.yes_ask as number | undefined;
            if (yesAskCents && yesAskCents > 0) {
              nowYesPct = yesAskCents;
            }
          }

          closeTime = String(
            mkt.close_time ?? mkt.expiration_time ?? ""
          );
        } catch {
          /* use defaults */
        }

        // Calculate verdict based on current NO win probability
        const noWinPct = 100 - nowYesPct;
        let verdict: string;
        let verdictColor: string;

        if (side === "NO") {
          if (noWinPct >= 80) {
            verdict = "likely WIN ✅";
            verdictColor = "#4ade80";
          } else if (noWinPct >= 60) {
            verdict = "coin flip ⚠️";
            verdictColor = "#fbbf24";
          } else {
            verdict = "at risk 🔴";
            verdictColor = "#f87171";
          }
        } else {
          // YES side
          if (nowYesPct >= 80) {
            verdict = "likely WIN ✅";
            verdictColor = "#4ade80";
          } else if (nowYesPct >= 60) {
            verdict = "coin flip ⚠️";
            verdictColor = "#fbbf24";
          } else {
            verdict = "at risk 🔴";
            verdictColor = "#f87171";
          }
        }

        // Market value = what we'd get if we sold now
        const currentPricePerContract =
          side === "NO" ? (100 - nowYesPct) / 100 : nowYesPct / 100;
        const marketValue = currentPricePerContract * contracts;
        const payoutIfWin = contracts * 1.0;

        return {
          ticker,
          title,
          side,
          contracts,
          avgPrice: Math.round(avgCost * 100) / 100,
          boughtPct: boughtYesPct,
          nowYesPct,
          marketValue: Math.round(marketValue * 100) / 100,
          payoutIfWin: Math.round(payoutIfWin * 100) / 100,
          verdict,
          verdictColor,
          closeTime,
        };
      })
    );

    const positionsValue = enriched.reduce(
      (sum, p) => sum + p.marketValue,
      0
    );

    return Response.json({
      ok: true,
      data: {
        portfolio: {
          portfolioValue:
            Math.round((cashDollars + positionsValue) * 100) / 100,
          cash: Math.round(cashDollars * 100) / 100,
          positionsValue: Math.round(positionsValue * 100) / 100,
        },
        positions: enriched,
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
