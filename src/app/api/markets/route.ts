// ============================================================================
// GET /api/markets — Live market data + whale activity from Supabase
// Polymarket WS feed runs server-side; this endpoint reads the results
// ============================================================================

export const runtime = "edge";

import { NextResponse } from "next/server";
import {
  connectPolymarketFeed,
  getRecentMarkets,
  getWhaleActivity,
  isConnected,
} from "@/lib/polymarket";
import type { MarketRow } from "@/lib/supabase";
import type { WhaleActivityRow } from "@/lib/polymarket";

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

interface MarketsResponse {
  markets: MarketRow[];
  whales: WhaleActivityRow[];
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Ensure WS feed is running (idempotent — won't double-connect)
// ---------------------------------------------------------------------------

let _feedStarted = false;

function ensureFeedRunning(): void {
  if (!_feedStarted) {
    try {
      connectPolymarketFeed();
      _feedStarted = true;
    } catch {
      // Edge runtime may not support persistent WS — graceful fallback
      console.warn("[markets] Could not start Polymarket WS in edge runtime");
    }
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // Try to start the WS feed (may not work in edge, that's fine)
    ensureFeedRunning();

    // Fetch from Supabase regardless of WS state
    const [markets, whales] = await Promise.all([
      getRecentMarkets(10),
      getWhaleActivity(10),
    ]);

    const response: MarketsResponse = {
      markets,
      whales,
      connected: isConnected(),
    };

    return NextResponse.json<ApiResponse<MarketsResponse>>({
      ok: true,
      data: response,
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
