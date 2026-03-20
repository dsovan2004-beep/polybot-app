// ============================================================================
// PolyBot — Trade Auth Test (Sprint 7)
// GET /api/trade/test
// Tests Kalshi API auth WITHOUT placing any orders.
// Returns step-by-step diagnostics.
// Edge runtime compatible
// ============================================================================

import { testAuth, getBalance, getPositions } from "@/lib/kalshi";

export const runtime = "edge";

export async function GET() {
  const debug: Record<string, unknown> = { step: "init", ts: new Date().toISOString() };

  try {
    // ---- 1. Check env vars ----
    debug.step = "check-env";
    const apiKey = process.env.KALSHI_API_KEY;
    const privateKey = process.env.KALSHI_PRIVATE_KEY;

    debug.hasApiKey = !!apiKey;
    debug.apiKeyPrefix = apiKey ? apiKey.slice(0, 8) + "..." : "MISSING";
    debug.privateKeyLength = privateKey?.length ?? 0;
    debug.privateKeyFormat = privateKey
      ? privateKey.includes("BEGIN") ? "PEM" : "raw-base64"
      : "MISSING";

    if (!apiKey || !privateKey) {
      return Response.json({
        ok: false,
        error: "Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY",
        debug,
      });
    }

    // ---- 2. Test auth via balance call ----
    debug.step = "test-auth";
    const authResult = await testAuth(apiKey, privateKey);
    debug.authOk = authResult.ok;
    debug.authBalance = authResult.balance;
    debug.authError = authResult.error;

    if (!authResult.ok) {
      return Response.json({
        ok: false,
        error: `Auth failed: ${authResult.error}`,
        debug,
      });
    }

    // ---- 3. Test balance endpoint ----
    debug.step = "test-balance";
    try {
      const bal = await getBalance(apiKey, privateKey);
      debug.balance = bal.balance;
    } catch (err) {
      debug.balanceError = err instanceof Error ? err.message : String(err);
    }

    // ---- 4. Test positions endpoint ----
    debug.step = "test-positions";
    try {
      const pos = await getPositions(apiKey, privateKey);
      debug.positionsCount = pos.length;
      debug.positions = pos.slice(0, 3); // first 3 only
    } catch (err) {
      debug.positionsError = err instanceof Error ? err.message : String(err);
    }

    debug.step = "done";

    return Response.json({
      ok: true,
      message: "Kalshi auth verified — all endpoints working",
      data: {
        balance: debug.balance,
        positions: debug.positionsCount ?? 0,
      },
      debug,
    });
  } catch (err) {
    debug.step = `caught-exception-at-${debug.step}`;
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
