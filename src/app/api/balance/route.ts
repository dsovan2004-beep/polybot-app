// ============================================================================
// PolyBot — Balance API (Sprint 6)
// GET /api/balance
// Returns Kalshi balance, open positions, total value, paper mode status
// Edge runtime compatible
// ============================================================================

import { getBalance, getPositions } from "@/lib/kalshi";

export const runtime = "edge";

export async function GET() {
  try {
    const apiKey = process.env.KALSHI_API_KEY;
    const privateKey = process.env.KALSHI_PRIVATE_KEY;

    // No Kalshi keys = paper mode
    if (!apiKey || !privateKey) {
      return Response.json({
        ok: true,
        data: {
          kalshi: 0,
          openPositions: 0,
          totalValue: 0,
          paperMode: true,
        },
      });
    }

    // Fetch balance + positions in parallel
    const [balResult, posResult] = await Promise.allSettled([
      getBalance(apiKey, privateKey),
      getPositions(apiKey, privateKey),
    ]);

    const balance =
      balResult.status === "fulfilled" ? balResult.value.balance : 0;
    const positions =
      posResult.status === "fulfilled" ? posResult.value : [];

    const openPositions = positions.length;
    const positionExposure = positions.reduce(
      (sum, p) => sum + Math.abs(p.market_exposure ?? 0),
      0
    );

    return Response.json({
      ok: true,
      data: {
        kalshi: Math.round(balance * 100) / 100,
        openPositions,
        totalValue: Math.round((balance + positionExposure / 100) * 100) / 100,
        paperMode: false,
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
