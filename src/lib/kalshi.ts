// ============================================================================
// PolyBot — Kalshi REST API Client (Sprint 6)
// RSA private key signing via Web Crypto API (edge-compatible)
// Base URL: https://trading-api.kalshi.com/trade-api/v2
// Auth: KALSHI-ACCESS-KEY + KALSHI-ACCESS-SIGNATURE + KALSHI-ACCESS-TIMESTAMP
// ============================================================================

const KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KalshiMarket {
  ticker: string;
  title: string;
  status: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
}

export interface KalshiOrder {
  order_id: string;
  ticker: string;
  side: string;
  action: string;
  count: number;
  yes_price: number | null;
  no_price: number | null;
  status: string;
  created_time: string;
}

export interface KalshiPosition {
  ticker: string;
  market_exposure: number;
  resting_orders_count: number;
  total_traded: number;
}

export interface KalshiBalance {
  balance: number;
}

export interface KalshiLimitOrderParams {
  marketTicker: string;
  side: "yes" | "no";
  price: number; // cents 1-99
  count: number;
  paperTrade: boolean;
}

export interface KalshiOrderResult {
  success: boolean;
  orderId: string | null;
  error: string | null;
  paperTrade: boolean;
}

// ---------------------------------------------------------------------------
// RSA Signing (Web Crypto API — edge-compatible)
// ---------------------------------------------------------------------------

/**
 * Import an RSA private key from PEM string using Web Crypto API.
 * Handles newlines stored as literal `\n` in env vars.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Normalize escaped newlines from env vars
  const normalized = pem.replace(/\\n/g, "\n");

  const pemBody = normalized
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Sign a Kalshi API request.
 * Message format: `${timestamp_ms}${METHOD}${path_without_query}`
 * No separators between fields. Query params stripped before signing.
 */
async function signRequest(
  privateKey: CryptoKey,
  timestampMs: string,
  method: string,
  path: string
): Promise<string> {
  // Strip query params — Kalshi signs only the path portion
  const pathOnly = path.split("?")[0];
  const message = `${timestampMs}${method}${pathOnly}`;
  const encoded = new TextEncoder().encode(message);

  const signature = await crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 },
    privateKey,
    encoded
  );

  // Base64 encode the signature
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface KalshiRequestInit {
  method: string;
  path: string;
  body?: unknown;
  apiKey: string;
  privateKey: string;
}

async function kalshiFetch<T>(init: KalshiRequestInit): Promise<T> {
  const timestampMs = String(Date.now());
  const cryptoKey = await importPrivateKey(init.privateKey);
  const signature = await signRequest(
    cryptoKey,
    timestampMs,
    init.method,
    init.path
  );

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": init.apiKey,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestampMs,
  };

  const res = await fetch(`${KALSHI_BASE_URL}${init.path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Kalshi ${res.status}: ${errText.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * Get Kalshi account balance.
 */
export async function getBalance(
  apiKey: string,
  privateKey: string
): Promise<KalshiBalance> {
  const data = await kalshiFetch<{ balance: number }>({
    method: "GET",
    path: "/portfolio/balance",
    apiKey,
    privateKey,
  });
  return { balance: data.balance / 100 }; // Kalshi returns cents
}

/**
 * Search Kalshi markets by keyword.
 */
export async function getMarkets(
  keyword: string,
  apiKey: string,
  privateKey: string
): Promise<KalshiMarket[]> {
  const encoded = encodeURIComponent(keyword);
  const data = await kalshiFetch<{ markets: KalshiMarket[] }>({
    method: "GET",
    path: `/markets?status=open&limit=20&cursor=&series_ticker=&event_ticker=&with_nested_markets=false&tickers=${encoded}`,
    apiKey,
    privateKey,
  });
  return data.markets ?? [];
}

/**
 * Place a limit order on Kalshi.
 * If paperTrade=true, logs and returns mock orderId. No real API call.
 */
export async function placeLimitOrder(
  params: KalshiLimitOrderParams,
  apiKey: string,
  privateKey: string
): Promise<KalshiOrderResult> {
  // Paper trade gate — NO real API call
  if (params.paperTrade) {
    console.log(
      `[kalshi] PAPER ORDER: ${params.side.toUpperCase()} ${params.count}x ${params.marketTicker} @ ${params.price}c`
    );
    return {
      success: true,
      orderId: `paper-${Date.now()}`,
      error: null,
      paperTrade: true,
    };
  }

  // Live mode — real API call
  try {
    const body = {
      ticker: params.marketTicker,
      action: "buy",
      side: params.side,
      count: params.count,
      type: "limit",
      ...(params.side === "yes"
        ? { yes_price: params.price }
        : { no_price: params.price }),
    };

    const data = await kalshiFetch<{ order: { order_id: string } }>({
      method: "POST",
      path: "/portfolio/orders",
      body,
      apiKey,
      privateKey,
    });

    return {
      success: true,
      orderId: data.order?.order_id ?? null,
      error: null,
      paperTrade: false,
    };
  } catch (err) {
    return {
      success: false,
      orderId: null,
      error: err instanceof Error ? err.message : "Unknown error",
      paperTrade: false,
    };
  }
}

/**
 * Cancel an open order by orderId.
 */
export async function cancelOrder(
  orderId: string,
  apiKey: string,
  privateKey: string
): Promise<boolean> {
  try {
    await kalshiFetch<unknown>({
      method: "DELETE",
      path: `/portfolio/orders/${orderId}`,
      apiKey,
      privateKey,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all open orders.
 */
export async function getOpenOrders(
  apiKey: string,
  privateKey: string
): Promise<KalshiOrder[]> {
  const data = await kalshiFetch<{ orders: KalshiOrder[] }>({
    method: "GET",
    path: "/portfolio/orders?status=resting",
    apiKey,
    privateKey,
  });
  return data.orders ?? [];
}

/**
 * Get current positions.
 */
export async function getPositions(
  apiKey: string,
  privateKey: string
): Promise<KalshiPosition[]> {
  const data = await kalshiFetch<{
    market_positions: KalshiPosition[];
  }>({
    method: "GET",
    path: "/portfolio/positions",
    apiKey,
    privateKey,
  });
  return data.market_positions ?? [];
}
