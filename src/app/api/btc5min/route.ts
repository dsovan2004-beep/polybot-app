// ============================================================================
// GET /api/btc5min — BTC 5-Minute Liquidation Signal
// Returns current window slug, countdown, liquidation stats, signal state
// ============================================================================

export const runtime = "edge";

import { NextResponse } from "next/server";
import { getBtc5MinSignal } from "@/lib/btc5min";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export async function GET() {
  try {
    const signal = getBtc5MinSignal();

    return NextResponse.json<ApiResponse<typeof signal>>({
      ok: true,
      data: signal,
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
