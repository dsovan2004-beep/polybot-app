// ============================================================================
// GET /api/markets — Dashboard market data & performance snapshot
// POST /api/markets — Record a new trade (from strategy engine)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import type { ApiResponse, Trade, Performance, DashboardData } from "@/lib/types";
import {
  getRecentTrades,
  getRecentSignals,
  getRecentWhaleAlerts,
  getBotState,
  computePerformance,
  insertTrade,
  getLatestSwarmResult,
} from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET — fetch dashboard data
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") ?? "paper") as "paper" | "live";
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

    const [trades, signals, whaleAlerts, botState, performance] =
      await Promise.all([
        getRecentTrades(limit, mode),
        getRecentSignals(30),
        getRecentWhaleAlerts(20),
        getBotState(),
        computePerformance(mode),
      ]);

    // Try to get latest swarm result for the most recent signal's market
    const latestMarketId = signals[0]?.marketId ?? null;
    const lastSwarm = latestMarketId
      ? await getLatestSwarmResult(latestMarketId)
      : null;

    const dashboard: DashboardData = {
      botStatus: botState?.status ?? "idle",
      mode,
      performance,
      positions: trades.filter(
        (t) =>
          (t.status === "filled" || t.status === "partially_filled") &&
          t.closedAt === null
      ),
      recentSignals: signals,
      whaleAlerts,
      lastSwarmResult: lastSwarm,
      wsState: {
        connected: false, // WS state lives client-side
        url: "",
        reconnectAttempts: 0,
        lastHeartbeat: null,
        subscribedChannels: [],
      },
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json<ApiResponse<DashboardData>>({
      ok: true,
      data: dashboard,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json<ApiResponse>(
      { ok: false, error: message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — record a new trade from the strategy engine
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate minimum confidence rule (67%)
    if (typeof body.aiConfidence === "number" && body.aiConfidence < 0.67) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: "Trade rejected: AI confidence below 67% minimum",
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Validate allowed categories
    const allowedCategories = ["ai_tech", "politics"];
    if (body.category && !allowedCategories.includes(body.category)) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: `Trade rejected: category "${body.category}" not in allowed list`,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const trade = await insertTrade(body);

    return NextResponse.json<ApiResponse<Trade>>({
      ok: true,
      data: trade,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json<ApiResponse>(
      { ok: false, error: message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
