// ============================================================================
// PolyBot — Telegram Alert System (Sprint 6)
// Bot: @Polybotsalerts_bot
// Edge-compatible (fetch only, no Node.js deps)
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env
// ============================================================================

const TELEGRAM_API = "https://api.telegram.org/bot";

// ---------------------------------------------------------------------------
// Core sender
// ---------------------------------------------------------------------------

/**
 * Send a Markdown message to the configured Telegram chat.
 * Silently returns false if token or chatId is missing.
 */
export async function sendAlert(
  message: string,
  botToken?: string,
  chatId?: string
): Promise<boolean> {
  if (!botToken || !chatId) return false;

  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Signal Alert
// ---------------------------------------------------------------------------

export interface SignalAlertParams {
  market: string;
  vote: string;
  confidence: number;
  price: number;
  strategy: string;
  reasoning: string;
}

/**
 * Send a formatted signal alert to Telegram.
 */
export async function sendSignalAlert(
  params: SignalAlertParams,
  botToken?: string,
  chatId?: string
): Promise<boolean> {
  const msg = [
    `*PolyBot Signal*`,
    ``,
    `Market: ${params.market}`,
    `Signal: ${params.vote}`,
    `Confidence: ${params.confidence}%`,
    `Price: ${params.price}c`,
    `Strategy: ${params.strategy}`,
    `Why: ${params.reasoning}`,
    ``,
    `polybot-app.pages.dev/bot`,
  ].join("\n");

  return sendAlert(msg, botToken, chatId);
}

// ---------------------------------------------------------------------------
// Trade Alert
// ---------------------------------------------------------------------------

export interface TradeAlertParams {
  market: string;
  side: string;
  size: number;
  price: number;
  orderId: string;
}

/**
 * Send a trade execution alert to Telegram.
 */
export async function sendTradeAlert(
  params: TradeAlertParams,
  botToken?: string,
  chatId?: string
): Promise<boolean> {
  const msg = [
    `*PolyBot Trade Executed*`,
    ``,
    `Market: ${params.market}`,
    `Side: ${params.side}`,
    `Size: $${params.size}`,
    `Price: ${params.price}c`,
    `Order: ${params.orderId}`,
  ].join("\n");

  return sendAlert(msg, botToken, chatId);
}

// ---------------------------------------------------------------------------
// P&L Alert
// ---------------------------------------------------------------------------

export interface PnLAlertParams {
  market: string;
  result: "WIN" | "LOSS";
  profit: number;
  winRate: number;
  totalPnL: number;
}

/**
 * Send a P&L result alert to Telegram.
 */
export async function sendPnLAlert(
  params: PnLAlertParams,
  botToken?: string,
  chatId?: string
): Promise<boolean> {
  const emoji = params.result === "WIN" ? "PolyBot WIN!" : "PolyBot LOSS";
  const msg = [
    `*${emoji}*`,
    ``,
    `Market: ${params.market}`,
    `Profit: $${params.profit.toFixed(2)}`,
    `Win Rate: ${params.winRate}%`,
    `Total P&L: $${params.totalPnL.toFixed(2)}`,
  ].join("\n");

  return sendAlert(msg, botToken, chatId);
}

// ---------------------------------------------------------------------------
// Kill Switch Alert
// ---------------------------------------------------------------------------

/**
 * Send kill switch activation alert to Telegram.
 */
export async function sendKillSwitchAlert(
  botToken?: string,
  chatId?: string
): Promise<boolean> {
  const msg = [
    `*KILL SWITCH ACTIVATED*`,
    ``,
    `Trading halted immediately.`,
    `Check dashboard: polybot-app.pages.dev/bot`,
  ].join("\n");

  return sendAlert(msg, botToken, chatId);
}
