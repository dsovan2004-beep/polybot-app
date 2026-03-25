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
import type { MarketRow, SignalRow } from "@/lib/supabase";
import { getRecentSignals } from "@/lib/supabase";
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
  signals: SignalRow[];
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
    // Fetch more markets (200) then filter to crypto-only on server side
    // Fetch more signals (200) to increase chance of matching crypto markets
    const [allMarkets, whales, signals] = await Promise.all([
      getRecentMarkets(200),
      getWhaleActivity(10),
      getRecentSignals(200),
    ]);

    // Filter to crypto-only markets (tickers starting with KX crypto prefixes)
    const cryptoPrefixes = ["KXBTC", "KXETH", "KXSOL", "KXXRP", "KXDOGE", "KXBNB", "KXHYPE"];
    const markets = allMarkets.filter((m) => {
      const ticker = (m.kalshi_ticker ?? m.polymarket_id ?? "").toUpperCase();
      return cryptoPrefixes.some((prefix) => ticker.startsWith(prefix));
    });

    const response: MarketsResponse = {
      markets: markets.slice(0, 30), // cap at 30 crypto markets
      whales,
      signals,
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
