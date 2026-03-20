// ============================================================================
// PolyBot — Kalshi REST API Client (Sprint 6 → Sprint 7 fix)
// RSA-PSS signing via Web Crypto API (edge-compatible)
// Base URL: https://api.elections.kalshi.com
// Auth: KALSHI-ACCESS-KEY + KALSHI-ACCESS-SIGNATURE + KALSHI-ACCESS-TIMESTAMP
// Ref: https://github.com/Kalshi/kalshi-starter-code-python/blob/main/clients.py
// ============================================================================

const KALSHI_HOST = "https://api.elections.kalshi.com";
const KALSHI_API_PREFIX = "/trade-api/v2";

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
// RSA-PSS Signing (Web Crypto API — edge-compatible)
// Matches official Kalshi Python starter: sign_pss_text()
// ---------------------------------------------------------------------------

/** Cache imported key to avoid re-importing on every request */
let _cachedKey: { pem: string; key: CryptoKey } | null = null;

/**
 * Import an RSA private key from PEM string using Web Crypto API.
 * Handles:
 *  - escaped `\n` from env vars
 *  - PKCS#8 (BEGIN PRIVATE KEY) — native Web Crypto format
 *  - PKCS#1 (BEGIN RSA PRIVATE KEY) — also works if DER is valid PKCS#8
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Return cached key if PEM unchanged
  if (_cachedKey && _cachedKey.pem === pem) return _cachedKey.key;

  // Normalize escaped newlines from env vars
  const normalized = pem.replace(/\\n/g, "\n");

  // Strip PEM headers/footers and whitespace
  const pemBody = normalized
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"]
  );

  _cachedKey = { pem, key };
  return key;
}

/**
 * Sign a Kalshi API request using RSA-PSS with SHA-256.
 *
 * CRITICAL: Message format is `${timestamp_ms}${METHOD}${full_path}`
 *  - NO separators (no \n) between fields
 *  - Query params stripped before signing
 *  - full_path INCLUDES the /trade-api/v2 prefix
 *  - salt_length = DIGEST_LENGTH (32 for SHA-256)
 *
 * Matches official: msg_string = timestamp_str + method + path_parts[0]
 */
async function signRequest(
  privateKey: CryptoKey,
  timestampMs: string,
  method: string,
  fullPath: string
): Promise<string> {
  // Strip query params — Kalshi signs only the path portion
  const pathOnly = fullPath.split("?")[0];
  const message = `${timestampMs}${method}${pathOnly}`;
  const encoded = new TextEncoder().encode(message);

  const signature = await crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 },
    privateKey,
    encoded
  );

  // Base64 encode — chunked to avoid stack overflow on large signatures
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface KalshiRequestInit {
  method: string;
  /** Relative path, e.g. "/portfolio/balance" — prefix added automatically */
  path: string;
  body?: unknown;
  apiKey: string;
  privateKey: string;
}

async function kalshiFetch<T>(init: KalshiRequestInit): Promise<T> {
  const timestampMs = String(Date.now());
  const cryptoKey = await importPrivateKey(init.privateKey);

  // Full path includes /trade-api/v2 prefix — this is what gets signed
  const fullPath = `${KALSHI_API_PREFIX}${init.path}`;

  const signature = await signRequest(
    cryptoKey,
    timestampMs,
    init.method,
    fullPath
  );

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": init.apiKey,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestampMs,
  };

  const url = `${KALSHI_HOST}${fullPath}`;

  const res = await fetch(url, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Kalshi ${init.method} ${fullPath} → ${res.status}: ${errText.slice(0, 300)}`
    );
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
 * Search Kalshi markets by ticker(s).
 */
export async function getMarkets(
  keyword: string,
  apiKey: string,
  privateKey: string
): Promise<KalshiMarket[]> {
  const encoded = encodeURIComponent(keyword);
  const data = await kalshiFetch<{ markets: KalshiMarket[] }>({
    method: "GET",
    path: `/markets?status=open&limit=20&tickers=${encoded}`,
    apiKey,
    privateKey,
  });
  return data.markets ?? [];
}

/**
 * Get a single market by exact ticker.
 * Returns null if not found.
 */
export async function getMarketByTicker(
  ticker: string,
  apiKey: string,
  privateKey: string
): Promise<KalshiMarket | null> {
  try {
    const data = await kalshiFetch<KalshiMarket>({
      method: "GET",
      path: `/markets/${encodeURIComponent(ticker)}`,
      apiKey,
      privateKey,
    });
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Title-based market search
// Kalshi has NO text search API — we fetch open events with nested markets
// then fuzzy-match client-side.
// ---------------------------------------------------------------------------

interface KalshiEvent {
  event_ticker: string;
  title: string;
  markets?: KalshiMarket[];
}

/** Words to strip when building keyword queries */
const STOP_WORDS = new Set([
  "will", "the", "a", "an", "be", "by", "in", "on", "of", "to", "for",
  "and", "or", "at", "is", "it", "this", "that", "do", "does", "did",
  "has", "have", "had", "can", "could", "would", "should", "may", "might",
  "not", "no", "yes", "before", "after", "than", "from", "with", "up",
  "down", "over", "under", "into", "out", "about", "between",
]);

/**
 * Extract keyword variations from a market title.
 * Returns array of query strings to try, from most specific to least.
 */
function extractKeywords(title: string): string[] {
  const words = title
    .replace(/[?!,."'()[\]{}:;]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const meaningful = words.filter(
    (w) => !STOP_WORDS.has(w.toLowerCase())
  );

  const queries: string[] = [];

  // 1. All meaningful words (best match)
  if (meaningful.length > 0) queries.push(meaningful.join(" "));

  // 2. First 3 meaningful words
  if (meaningful.length > 3) queries.push(meaningful.slice(0, 3).join(" "));

  // 3. First 2 meaningful words
  if (meaningful.length > 2) queries.push(meaningful.slice(0, 2).join(" "));

  return queries;
}

/**
 * Score how well a Kalshi market title matches search keywords.
 * Higher score = better match. Returns 0 if no overlap.
 */
function scoreMatch(kalshiTitle: string, searchWords: string[]): number {
  const lower = kalshiTitle.toLowerCase();
  let score = 0;
  for (const word of searchWords) {
    if (lower.includes(word.toLowerCase())) {
      score += word.length; // longer word matches are worth more
    }
  }
  return score;
}

/**
 * Search Kalshi for a market matching a Polymarket title.
 * Uses GET /events with nested markets, then fuzzy-matches titles.
 *
 * Returns: { market, searched, queries } or null
 */
export async function searchMarketByTitle(
  polymarketTitle: string,
  apiKey: string,
  privateKey: string
): Promise<{
  market: KalshiMarket | null;
  searched: boolean;
  queries: string[];
  candidateCount: number;
  bestScore: number;
  debug: string[];
}> {
  const debugLog: string[] = [];
  const queries = extractKeywords(polymarketTitle);
  debugLog.push(`Title: "${polymarketTitle}"`);
  debugLog.push(`Keywords: ${JSON.stringify(queries)}`);

  if (queries.length === 0) {
    debugLog.push("No keywords extracted");
    return { market: null, searched: false, queries, candidateCount: 0, bestScore: 0, debug: debugLog };
  }

  // Fetch open events with nested markets (up to 200)
  let allMarkets: KalshiMarket[] = [];
  try {
    const data = await kalshiFetch<{
      events: KalshiEvent[];
      markets?: KalshiMarket[];
    }>({
      method: "GET",
      path: "/events?status=open&with_nested_markets=true&limit=200",
      apiKey,
      privateKey,
    });

    // Markets can be nested inside events OR as top-level field
    if (data.markets && data.markets.length > 0) {
      allMarkets = data.markets;
    } else if (data.events) {
      for (const evt of data.events) {
        if (evt.markets) allMarkets.push(...evt.markets);
      }
    }
    debugLog.push(`Fetched ${allMarkets.length} markets from ${data.events?.length ?? 0} events`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog.push(`Events fetch failed: ${msg}`);
    return { market: null, searched: true, queries, candidateCount: 0, bestScore: 0, debug: debugLog };
  }

  // Score all markets against each keyword variation
  const searchWords = queries[0].split(/\s+/); // use most complete keyword set
  let bestMarket: KalshiMarket | null = null;
  let bestScore = 0;

  for (const m of allMarkets) {
    if (m.status !== "open") continue;
    const s = scoreMatch(m.title ?? "", searchWords);
    if (s > bestScore) {
      bestScore = s;
      bestMarket = m;
    }
  }

  if (bestMarket) {
    debugLog.push(`Best match: "${bestMarket.title}" (ticker: ${bestMarket.ticker}, score: ${bestScore})`);
  } else {
    debugLog.push(`No match found among ${allMarkets.length} markets`);
  }

  return {
    market: bestMarket,
    searched: true,
    queries,
    candidateCount: allMarkets.length,
    bestScore,
    debug: debugLog,
  };
}

/**
 * Verify Kalshi auth is working by fetching balance.
 * Returns { ok, balance, error } for diagnostics.
 */
export async function testAuth(
  apiKey: string,
  privateKey: string
): Promise<{ ok: boolean; balance?: number; error?: string }> {
  try {
    const data = await kalshiFetch<{ balance: number }>({
      method: "GET",
      path: "/portfolio/balance",
      apiKey,
      privateKey,
    });
    return { ok: true, balance: data.balance / 100 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
