// ============================================================================
// PolyBot — Trade Execution API (Sprint 6)
// POST /api/trade
// 1. Check kill switch
// 2. Check paper mode
// 3. Get Kalshi balance
// 4. Size: 5% of balance, max $10
// 5. Place order via kalshi.ts
// 6. Save to Supabase trades table
// 7. Send Telegram alert
// Edge runtime compatible
// ============================================================================

import { getServiceSupabase } from "@/lib/supabase";
import { getBalance, placeLimitOrder } from "@/lib/kalshi";
import { sendTradeAlert, sendKillSwitchAlert } from "@/lib/telegram";

export const runtime = "edge";

const MAX_TRADE_SIZE = 10; // $10 max for first 30 trades

// ---------------------------------------------------------------------------
// POST /api/trade
// ---------------------------------------------------------------------------

interface TradeRequestBody {
  signal: {
    id: string;
    market_id: string;
    consensus: string;
    confidence: number;
    market_price: number;
    strategy: string;
  };
  marketTicker: string;
  paperTrade: boolean;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TradeRequestBody;
    const { signal, marketTicker, paperTrade } = body;

    if (!signal || !marketTicker) {
      return Response.json(
        { ok: false, error: "Missing signal or marketTicker" },
        { status: 400 }
      );
    }

    // ---- 1. Kill switch check ----
    const today = new Date().toISOString().slice(0, 10);
    const { data: perfData } = await getServiceSupabase()
      .from("performance")
      .select("kill_switch")
      .eq("date", today)
      .single();

    if (perfData?.kill_switch === true) {
      // Send Telegram kill switch alert
      await sendKillSwitchAlert(
        process.env.TELEGRAM_BOT_TOKEN,
        process.env.TELEGRAM_CHAT_ID
      );
      return Response.json(
        { ok: false, error: "Kill switch active — trade blocked" },
        { status: 403 }
      );
    }

    // ---- 2. Determine side + price ----
    const side: "yes" | "no" =
      signal.consensus === "YES" ? "yes" : "no";
    const price = Math.round((signal.market_price ?? 0.5) * 100); // cents

    // ---- 3. Calculate trade size ----
    let tradeSize = MAX_TRADE_SIZE; // default

    const kalshiApiKey = process.env.KALSHI_API_KEY;
    const kalshiPrivateKey = process.env.KALSHI_PRIVATE_KEY;

    if (!paperTrade && kalshiApiKey && kalshiPrivateKey) {
      try {
        const bal = await getBalance(kalshiApiKey, kalshiPrivateKey);
        const fivePct = bal.balance * 0.05;
        tradeSize = Math.min(fivePct, MAX_TRADE_SIZE);
      } catch {
        // Fall back to max
        tradeSize = MAX_TRADE_SIZE;
      }
    }

    // Minimum trade: $1
    if (tradeSize < 1) {
      return Response.json(
        { ok: false, error: "Insufficient balance (< $1)" },
        { status: 400 }
      );
    }

    const count = Math.max(1, Math.floor(tradeSize));

    // ---- 4. Place order ----
    const orderResult = await placeLimitOrder(
      {
        marketTicker,
        side,
        price,
        count,
        paperTrade,
      },
      kalshiApiKey ?? "",
      kalshiPrivateKey ?? ""
    );

    if (!orderResult.success) {
      return Response.json(
        { ok: false, error: orderResult.error ?? "Order failed" },
        { status: 500 }
      );
    }

    // ---- 5. Save to Supabase trades table ----
    const tradePayload = {
      signal_id: signal.id,
      market_id: signal.market_id,
      direction: side,
      entry_price: signal.market_price,
      shares: count,
      entry_cost: tradeSize,
      strategy: signal.strategy ?? "unknown",
      status: "open",
      notes: orderResult.paperTrade
        ? `PAPER: ${orderResult.orderId}`
        : `LIVE: ${orderResult.orderId}`,
    };

    const { error: tradeErr } = await getServiceSupabase()
      .from("trades")
      .insert(tradePayload);

    if (tradeErr) {
      console.error("[trade] Supabase save failed:", tradeErr.message);
      // Don't fail the whole request — the order was already placed
    }

    // ---- 6. Telegram alert ----
    await sendTradeAlert(
      {
        market: marketTicker,
        side: side.toUpperCase(),
        size: tradeSize,
        price,
        orderId: orderResult.orderId ?? "unknown",
      },
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID
    );

    return Response.json({
      ok: true,
      data: {
        orderId: orderResult.orderId,
        size: tradeSize,
        side,
        price,
        paperTrade: orderResult.paperTrade,
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
