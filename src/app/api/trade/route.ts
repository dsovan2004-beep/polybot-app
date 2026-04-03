// ============================================================================
// PolyBot — Trade Execution API (Sprint 7)
// POST /api/trade
// Uses kalshi_ticker directly from signal — no more fuzzy search
// Edge runtime compatible
// ============================================================================

import { getServiceSupabase } from "@/lib/supabase";
import { getBalance, placeLimitOrder } from "@/lib/kalshi";
import { sendTradeAlert, sendKillSwitchAlert } from "@/lib/telegram";

export const runtime = "edge";

// Position sizing — matches feed.ts calculateTradeSize() exactly
const POSITION_SIZE_PCT = 0.03;       // 3% of balance per trade
const MIN_TRADE_DOLLARS = 0.50;       // Floor
const MAX_TRADE_DOLLARS_CAP = 15.00;  // Ceiling

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
  /** Kalshi ticker — passed directly from dashboard (from markets.kalshi_ticker) */
  marketTicker: string;
  paperTrade: boolean;
}

export async function POST(request: Request) {
  const debug: Record<string, unknown> = { step: "init" };

  try {
    // ---- 0. Parse body ----
    debug.step = "parse-body";
    const body = (await request.json()) as TradeRequestBody;
    const { signal, marketTicker, paperTrade } = body;

    debug.marketTicker = marketTicker;
    debug.paperTrade = paperTrade;
    debug.consensus = signal?.consensus;
    debug.confidence = signal?.confidence;

    if (!signal || !marketTicker) {
      return Response.json(
        { ok: false, error: "Missing signal or marketTicker", debug },
        { status: 400 }
      );
    }

    // ---- 1. Kill switch check ----
    debug.step = "kill-switch-check";
    const today = new Date().toISOString().slice(0, 10);
    const { data: perfData } = await getServiceSupabase()
      .from("performance")
      .select("kill_switch")
      .eq("date", today)
      .single();

    if (perfData?.kill_switch === true) {
      await sendKillSwitchAlert(
        process.env.TELEGRAM_BOT_TOKEN,
        process.env.TELEGRAM_CHAT_ID
      );
      return Response.json(
        { ok: false, error: "Kill switch active — trade blocked", debug },
        { status: 403 }
      );
    }

    // ---- 2. Determine side + price ----
    debug.step = "compute-side-price";
    const side: "yes" | "no" =
      signal.consensus === "YES" ? "yes" : "no";
    const price = Math.round((signal.market_price ?? 0.5) * 100); // cents
    debug.side = side;
    debug.priceCents = price;

    // ---- 3. Kalshi auth check ----
    debug.step = "check-kalshi-keys";
    const kalshiApiKey = process.env.KALSHI_API_KEY;
    const kalshiPrivateKey = process.env.KALSHI_PRIVATE_KEY;

    if (!paperTrade && (!kalshiApiKey || !kalshiPrivateKey)) {
      return Response.json(
        { ok: false, error: "Kalshi API keys missing", debug },
        { status: 400 }
      );
    }

    // ---- 4. Calculate trade size (matches feed.ts calculateTradeSize) ----
    debug.step = "calculate-size";
    const confidence = Number(signal.confidence ?? 67);
    let tradeSize = MAX_TRADE_DOLLARS_CAP; // fallback

    if (!paperTrade && kalshiApiKey && kalshiPrivateKey) {
      try {
        const bal = await getBalance(kalshiApiKey, kalshiPrivateKey);
        debug.kalshiBalance = bal.balance;
        const base = bal.balance * POSITION_SIZE_PCT;
        let multiplier = 0.55;
        if (confidence >= 90) multiplier = 1.0;
        else if (confidence >= 80) multiplier = 0.85;
        else if (confidence >= 70) multiplier = 0.70;
        let sized = base * multiplier;
        sized = Math.max(MIN_TRADE_DOLLARS, sized);
        sized = Math.min(MAX_TRADE_DOLLARS_CAP, sized);
        tradeSize = Math.round(sized * 100) / 100;
      } catch (balErr) {
        debug.balanceError =
          balErr instanceof Error ? balErr.message : String(balErr);
        tradeSize = MAX_TRADE_DOLLARS_CAP;
      }
    }

    debug.tradeSize = tradeSize;

    if (tradeSize < MIN_TRADE_DOLLARS) {
      return Response.json(
        { ok: false, error: `Insufficient balance (< $${MIN_TRADE_DOLLARS})`, debug },
        { status: 400 }
      );
    }

    const pricePerContract = price / 100; // convert cents to dollars
    const count = Math.max(1, Math.floor(tradeSize / pricePerContract));
    debug.count = count;
    debug.pricePerContract = pricePerContract;

    // ---- 5. Place order (ticker comes directly from Kalshi feed) ----
    debug.step = "place-order";
    const orderResult = await placeLimitOrder(
      { marketTicker, side, price, count, paperTrade },
      kalshiApiKey ?? "",
      kalshiPrivateKey ?? ""
    );

    debug.orderSuccess = orderResult.success;
    debug.orderId = orderResult.orderId;
    debug.orderError = orderResult.error;

    // Only proceed if Kalshi actually returned an order ID
    if (!orderResult.success || !orderResult.orderId) {
      return Response.json(
        {
          ok: false,
          error: orderResult.error ?? "Kalshi did not return an order ID",
          debug,
        },
        { status: 500 }
      );
    }

    // ---- 6. Save to Supabase trades table (only after confirmed Kalshi order) ----
    debug.step = "save-trade";
    const { error: tradeErr } = await getServiceSupabase()
      .from("trades")
      .insert({
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
          : `LIVE: ${orderResult.orderId} | ${marketTicker}`,
      });

    if (tradeErr) {
      debug.supabaseError = tradeErr.message;
      console.error("[trade] Supabase save failed:", tradeErr.message);
    }

    // ---- 7. Telegram alert ----
    debug.step = "telegram-alert";
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

    debug.step = "done";

    return Response.json({
      ok: true,
      data: {
        orderId: orderResult.orderId,
        size: tradeSize,
        side,
        price,
        paperTrade: orderResult.paperTrade,
        ticker: marketTicker,
      },
      debug,
    });
  } catch (err) {
    debug.step = `caught-exception-at-${debug.step}`;
    debug.error = err instanceof Error ? err.message : String(err);

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
