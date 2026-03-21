// ============================================================================
// PolyBot — Balance API (Sprint 6 → Sprint 7 debug)
// GET /api/balance
// Returns Kalshi balance, open positions, total value, paper mode status
// Edge runtime compatible
// ============================================================================

import { getBalance, getPositions, getMarketByTicker } from "@/lib/kalshi";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "edge";

export async function GET() {
  const debug: Record<string, unknown> = { step: "init" };

  try {
    const apiKey = process.env.KALSHI_API_KEY;
    const privateKey = process.env.KALSHI_PRIVATE_KEY;

    debug.hasApiKey = !!apiKey;
    debug.apiKeyPrefix = apiKey ? apiKey.slice(0, 8) + "..." : "MISSING";
    debug.privateKeyLength = privateKey?.length ?? 0;
    debug.privateKeyStart = privateKey
      ? privateKey.slice(0, 30) + "..."
      : "MISSING";

    // No Kalshi keys = paper mode
    if (!apiKey || !privateKey) {
      return Response.json({
        ok: true,
        data: {
          kalshi: 0,
          openPositions: 0,
          totalValue: 0,
          paperMode: true,
          debug: { ...debug, step: "no-keys-paper-mode" },
        },
      });
    }

    // Step 1: Fetch balance
    debug.step = "fetching-balance";
    const [balResult, posResult] = await Promise.allSettled([
      getBalance(apiKey, privateKey),
      getPositions(apiKey, privateKey),
    ]);

    debug.balanceStatus = balResult.status;
    debug.positionsStatus = posResult.status;

    if (balResult.status === "rejected") {
      const reason = balResult.reason;
      debug.balanceError =
        reason instanceof Error ? reason.message : String(reason);
      console.error("[balance] getBalance failed:", debug.balanceError);
    } else {
      debug.balanceRaw = balResult.value;
      console.log(
        "[balance] Raw balance:",
        JSON.stringify(balResult.value)
      );
    }

    if (posResult.status === "rejected") {
      const reason = posResult.reason;
      debug.positionsError =
        reason instanceof Error ? reason.message : String(reason);
      console.error("[balance] getPositions failed:", debug.positionsError);
    }

    const balance =
      balResult.status === "fulfilled" ? balResult.value.balance : 0;
    const positions =
      posResult.status === "fulfilled" ? posResult.value : [];

    const openPositions = positions.length;
    const positionExposure = positions.reduce(
      (sum, p) => sum + Math.abs(p.market_exposure ?? 0),
      0
    );

    // Enrich positions with market titles — pass through ALL raw Kalshi fields
    debug.step = "enriching-positions";
    // Log first raw position for debugging
    if (positions.length > 0) {
      debug.rawPositionSample = positions[0];
      debug.rawPositionKeys = Object.keys(positions[0] as unknown as Record<string, unknown>);
    }
    const enrichedPositions = await Promise.all(
      positions.map(async (pos, idx) => {
        // Cast to access ALL runtime fields (Kalshi returns more than our TS interface)
        const raw = pos as unknown as Record<string, unknown>;
        let title = pos.ticker;
        try {
          const mkt = await getMarketByTicker(pos.ticker, apiKey!, privateKey!);
          // Kalshi wraps: { market: { title, ... } } — must unwrap
          const mktRaw = mkt as unknown as Record<string, unknown>;
          const mktInner = ((mktRaw?.market as Record<string, unknown>) ?? mktRaw) as Record<string, unknown> | null;
          if (idx === 0) {
            debug.rawMarketResponse = mktRaw;
            debug.rawMarketInner = mktInner;
            debug.rawMarketKeys = mktInner ? Object.keys(mktInner) : [];
          }
          const t = mktInner?.title ?? mktInner?.subtitle ?? mktInner?.question;
          if (t) title = String(t);
        } catch { /* keep ticker as fallback */ }
        // Normalize Kalshi fields for frontend:
        // position_fp: "-2.00" = 2 NO contracts, "1.00" = 1 YES contract (string)
        // market_exposure_dollars: "1.0800" = exposure in dollars (string, always positive)
        // Compute market_exposure (cents, signed) so page.tsx can use it directly
        const positionFp = parseFloat(String(raw.position_fp ?? "0"));
        const exposureDollars = parseFloat(String(raw.market_exposure_dollars ?? "0"));
        const sign = positionFp < 0 ? -1 : 1;
        return {
          ...raw,
          title,
          market_exposure: Math.round(exposureDollars * 100) * sign,
        };
      })
    );

    // Compute P&L stats from Kalshi positions + Supabase trades
    debug.step = "computing-pnl";
    // Realized P&L from Kalshi positions (sum of realized_pnl_dollars)
    const realizedPnl = enrichedPositions.reduce((sum, p) => {
      const raw = p as Record<string, unknown>;
      return sum + parseFloat(String(raw.realized_pnl_dollars ?? "0"));
    }, 0);

    // Win rate from Supabase trades table (resolved trades only)
    let tradesCount = 0;
    let wins = 0;
    try {
      const { data: trades } = await getServiceSupabase()
        .from("trades")
        .select("pnl, status")
        .neq("status", "open");
      if (trades && trades.length > 0) {
        tradesCount = trades.length;
        wins = trades.filter((t: { pnl: number | null }) => (t.pnl ?? 0) > 0).length;
      }
    } catch { /* trades query optional — don't block response */ }

    const winRate = tradesCount > 0 ? wins / tradesCount : 0;

    // Last Telegram alert timestamp (most recent actionable signal)
    let lastAlertAt: string | null = null;
    try {
      const { data: alertRow } = await getServiceSupabase()
        .from("signals")
        .select("created_at")
        .or("consensus.eq.YES,consensus.eq.NO")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (alertRow) lastAlertAt = alertRow.created_at;
    } catch { /* no alerts yet — fine */ }

    // P&L history — cumulative pnl over last 10 resolved trades (for sparkline)
    let pnlHistory: number[] = [];
    try {
      const { data: histTrades } = await getServiceSupabase()
        .from("trades")
        .select("pnl")
        .neq("status", "open")
        .order("created_at", { ascending: true })
        .limit(10);
      if (histTrades && histTrades.length > 0) {
        let cumulative = 0;
        pnlHistory = histTrades.map((t: { pnl: number | null }) => {
          cumulative += t.pnl ?? 0;
          return Math.round(cumulative * 100) / 100;
        });
      }
    } catch { /* optional — don't block response */ }

    debug.realizedPnl = realizedPnl;
    debug.tradesCount = tradesCount;
    debug.wins = wins;
    debug.lastAlertAt = lastAlertAt;

    debug.step = "done";
    debug.finalBalance = balance;
    debug.openPositions = openPositions;

    return Response.json({
      ok: true,
      data: {
        kalshi: Math.round(balance * 100) / 100,
        openPositions,
        positions: enrichedPositions,
        totalPnl: Math.round(realizedPnl * 100) / 100,
        winRate,
        tradesCount,
        wins,
        totalValue:
          Math.round((balance + positionExposure / 100) * 100) / 100,
        lastAlertAt,
        pnlHistory,
        paperMode: false,
        debug,
      },
    });
  } catch (err) {
    debug.step = "caught-exception";
    debug.error = err instanceof Error ? err.message : String(err);
    debug.stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;

    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
        debug,
      },
      { status: 500 }
    );
  }
}
