// ============================================================================
// PolyBot — Trade Execution API (Sprint 6 → Sprint 7 fix)
// POST /api/trade
// Step-by-step: kill switch → auth → balance → size → find ticker → order
// Edge runtime compatible
// ============================================================================

import { getServiceSupabase } from "@/lib/supabase";
import {
  getBalance,
  getMarketByTicker,
  searchMarketByTitle,
  placeLimitOrder,
} from "@/lib/kalshi";
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
    market_title?: string;
  };
  marketTicker: string;
  /** Market title from Polymarket — used to fuzzy-search Kalshi */
  marketTitle?: string;
  paperTrade: boolean;
}

export async function POST(request: Request) {
  const debug: Record<string, unknown> = { step: "init" };

  try {
    // ---- 0. Parse body ----
    debug.step = "parse-body";
    const body = (await request.json()) as TradeRequestBody;
    const { signal, marketTicker, marketTitle, paperTrade } = body;

    debug.marketTicker = marketTicker;
    debug.marketTitle = marketTitle;
    debug.paperTrade = paperTrade;
    debug.consensus = signal?.consensus;
    debug.confidence = signal?.confidence;

    if (!signal) {
      return Response.json(
        { ok: false, error: "Missing signal", debug },
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

    debug.killSwitch = perfData?.kill_switch ?? false;

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

    debug.hasApiKey = !!kalshiApiKey;
    debug.hasPrivateKey = !!kalshiPrivateKey;

    if (!paperTrade && (!kalshiApiKey || !kalshiPrivateKey)) {
      return Response.json(
        {
          ok: false,
          error: "Kalshi API keys missing — cannot place live trade",
          debug,
        },
        { status: 400 }
      );
    }

    // ---- 4. Calculate trade size ----
    debug.step = "calculate-size";
    let tradeSize = MAX_TRADE_SIZE;

    if (!paperTrade && kalshiApiKey && kalshiPrivateKey) {
      try {
        const bal = await getBalance(kalshiApiKey, kalshiPrivateKey);
        debug.kalshiBalance = bal.balance;
        const fivePct = bal.balance * 0.05;
        tradeSize = Math.min(fivePct, MAX_TRADE_SIZE);
        debug.fivePctSize = fivePct;
      } catch (balErr) {
        debug.balanceError =
          balErr instanceof Error ? balErr.message : String(balErr);
        tradeSize = MAX_TRADE_SIZE;
      }
    }

    debug.tradeSize = tradeSize;

    if (tradeSize < 1) {
      return Response.json(
        { ok: false, error: "Insufficient balance (< $1)", debug },
        { status: 400 }
      );
    }

    const count = Math.max(1, Math.floor(tradeSize));
    debug.count = count;

    // ---- 5. Resolve Kalshi ticker ----
    // Strategy: try exact ticker first, then fuzzy search by title
    debug.step = "resolve-ticker";
    let resolvedTicker: string | null = null;

    if (!paperTrade && kalshiApiKey && kalshiPrivateKey) {
      // 5a. Try exact ticker lookup (in case marketTicker IS a Kalshi ticker)
      try {
        const exact = await getMarketByTicker(
          marketTicker,
          kalshiApiKey,
          kalshiPrivateKey
        );
        if (exact) {
          resolvedTicker = exact.ticker;
          debug.tickerMethod = "exact-match";
          debug.kalshiMarketTitle = exact.title;
        }
      } catch {
        // Not found — continue to title search
      }

      // 5b. If exact failed, search by market title
      if (!resolvedTicker && marketTitle) {
        debug.step = "search-by-title";
        const searchResult = await searchMarketByTitle(
          marketTitle,
          kalshiApiKey,
          kalshiPrivateKey
        );
        debug.searchResult = {
          queries: searchResult.queries,
          candidateCount: searchResult.candidateCount,
          bestScore: searchResult.bestScore,
          log: searchResult.debug,
        };

        if (searchResult.market && searchResult.bestScore > 10) {
          resolvedTicker = searchResult.market.ticker;
          debug.tickerMethod = "title-search";
          debug.kalshiMarketTitle = searchResult.market.title;
        }
      }

      // 5c. If still no match → block the trade
      if (!resolvedTicker) {
        debug.tickerMethod = "not-found";
        return Response.json(
          {
            ok: false,
            error: "Market not on Kalshi — trade manually",
            kalshiSearched: true,
            debug,
          },
          { status: 404 }
        );
      }
    } else {
      // Paper trade — use whatever ticker was sent
      resolvedTicker = marketTicker;
    }

    debug.resolvedTicker = resolvedTicker;

    // ---- 6. Place order ----
    debug.step = "place-order";
    const orderResult = await placeLimitOrder(
      {
        marketTicker: resolvedTicker,
        side,
        price,
        count,
        paperTrade,
      },
      kalshiApiKey ?? "",
      kalshiPrivateKey ?? ""
    );

    debug.orderSuccess = orderResult.success;
    debug.orderId = orderResult.orderId;
    debug.orderPaper = orderResult.paperTrade;

    if (!orderResult.success) {
      debug.orderError = orderResult.error;
      return Response.json(
        { ok: false, error: orderResult.error ?? "Order failed", debug },
        { status: 500 }
      );
    }

    // ---- 7. Save to Supabase trades table ----
    debug.step = "save-trade";
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
        : `LIVE: ${orderResult.orderId} | ${resolvedTicker}`,
    };

    const { error: tradeErr } = await getServiceSupabase()
      .from("trades")
      .insert(tradePayload);

    if (tradeErr) {
      debug.supabaseError = tradeErr.message;
      console.error("[trade] Supabase save failed:", tradeErr.message);
    } else {
      debug.supabaseSaved = true;
    }

    // ---- 8. Telegram alert ----
    debug.step = "telegram-alert";
    await sendTradeAlert(
      {
        market: resolvedTicker,
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
        ticker: resolvedTicker,
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
