// ============================================================================
// GET /api/markets — Dashboard data (markets, signals, trades, performance)
// POST /api/markets — Record a new trade
// Matches Sprint 2 Supabase schema (snake_case columns)
// ============================================================================

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import type {
  MarketRow,
  SignalRow,
  TradeRow,
  PerformanceRow,
  RebateRow,
} from "@/lib/supabase";
import {
  getMarkets,
  getRecentSignals,
  getRecentTrades,
  getOpenTrades,
  getLatestPerformance,
  getRecentRebates,
  insertTrade,
} from "@/lib/supabase";

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Dashboard shape
// ---------------------------------------------------------------------------

interface DashboardData {
  markets: MarketRow[];
  signals: SignalRow[];
  openTrades: TradeRow[];
  recentTrades: TradeRow[];
  performance: PerformanceRow | null;
  rebates: RebateRow[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// GET — fetch dashboard data
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") ?? undefined;
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

    const [markets, signals, openTrades, recentTrades, performance, rebates] =
      await Promise.all([
        getMarkets(category, limit),
        getRecentSignals(30),
        getOpenTrades(),
        getRecentTrades(limit),
        getLatestPerformance(),
        getRecentRebates(30),
      ]);

    const dashboard: DashboardData = {
      markets,
      signals,
      openTrades,
      recentTrades,
      performance,
      rebates,
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
// POST — record a new trade
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    if (!body.direction) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: "Missing required field: direction",
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Validate allowed categories if market_id is provided with category
    const allowedCategories = ["ai_tech", "politics"];
    if (body.category && !allowedCategories.includes(body.category)) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: `Trade rejected: category "${body.category}" not allowed`,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const trade = await insertTrade(body);

    return NextResponse.json<ApiResponse<TradeRow>>({
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
