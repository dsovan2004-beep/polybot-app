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

    console.log("[balance] Kalshi API key present:", apiKey.slice(0, 8) + "...");
    console.log("[balance] Private key length:", privateKey.length);

    // Fetch balance + positions in parallel
    const [balResult, posResult] = await Promise.allSettled([
      getBalance(apiKey, privateKey),
      getPositions(apiKey, privateKey),
    ]);

    if (balResult.status === "rejected") {
      console.error("[balance] getBalance failed:", balResult.reason);
    } else {
      console.log("[balance] Raw balance response:", JSON.stringify(balResult.value));
    }
    if (posResult.status === "rejected") {
      console.error("[balance] getPositions failed:", posResult.reason);
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

    console.log("[balance] Final balance:", balance, "openPositions:", openPositions);

    return Response.json({
      ok: true,
      data: {
        kalshi: Math.round(balance * 100) / 100,
        openPositions,
        totalValue: Math.round((balance + positionExposure / 100) * 100) / 100,
        paperMode: false,
        debug: {
          balanceStatus: balResult.status,
          balanceError: balResult.status === "rejected" ? String(balResult.reason) : null,
          positionsStatus: posResult.status,
        },
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
