// ============================================================================
// PolyBot — Balance API (Sprint 6 → Sprint 7 debug)
// GET /api/balance
// Returns Kalshi balance, open positions, total value, paper mode status
// Edge runtime compatible
// ============================================================================

import { getBalance, getPositions, getMarketByTicker } from "@/lib/kalshi";

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
        // Spread ALL raw fields so frontend gets whatever Kalshi returns
        return {
          ...raw,
          title,
        };
      })
    );

    debug.step = "done";
    debug.finalBalance = balance;
    debug.openPositions = openPositions;

    return Response.json({
      ok: true,
      data: {
        kalshi: Math.round(balance * 100) / 100,
        openPositions,
        positions: enrichedPositions,
        totalValue:
          Math.round((balance + positionExposure / 100) * 100) / 100,
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
