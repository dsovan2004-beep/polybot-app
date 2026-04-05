# PolyBot Full Codebase Audit Report

**Date:** April 2, 2026
**Scope:** Read-only audit of all source files
**Balance at time of audit:** ~$309 portfolio

---

## 1. Logic Bugs

### 1.1 KXHYPED missing from coinMap in 3 API routes

**Files:** `src/app/api/stats/route.ts` (line 34–41), `src/app/api/positions/route.ts` (line 18–21), `src/app/bot/page.tsx` (line 264–267)

**Severity:** Medium

All three files define a `coinMap` that maps Kalshi series tickers to human-readable coin names (e.g., `KXBTCD → "BTC"`). None of them include `KXHYPED → "HYPE"`, which was added in Sprint 13. HYPE positions and trades will show the raw series ticker instead of "HYPE" in the dashboard, stats bar, and positions table.

**Recommended fix:** Add `KXHYPED: "HYPE"` to all three coinMap objects.

---

### 1.2 KXETH15M not handled in ticker parsers (3 files)

**Files:** `src/app/api/stats/route.ts` (line 18–26), `src/app/api/positions/route.ts` (line 24–35), `src/app/bot/page.tsx` (line 269–277)

**Severity:** Medium

All three ticker-parsing functions only handle `KXBTC15M` for 15-minute markets. If ETH 15-minute markets (`KXETH15M`) are ever traded (the feed.ts discovery loop already includes `KXETH15M` in its series list), the ticker will not parse correctly. The positions API, stats API, and dashboard will show raw ticker strings instead of formatted labels like "ETH 15m $3,500 · 1:00pm ET".

**Recommended fix:** Add KXETH15M regex branches to `parseTickerTitle()` in stats, `parseTickerLabel()` in positions, and `parseCryptoTicker()` in page.tsx. Consider also adding SOL/XRP/DOGE/BNB/HYPE 15m parsers if those series are planned.

---

### 1.3 Variable shadowing: `isCrypto` in prompt IIFE

**File:** `src/scripts/feed.ts` (~line 1148)

**Severity:** Low

Inside the `analyzeMarket()` function, the direction context IIFE declares a local `isCrypto` variable that shadows the `isCrypto` parameter passed to `analyzeMarket()`. This currently doesn't cause bugs because the IIFE uses `cryptoPrices` and `kalshiTicker` directly, but it's a maintenance hazard — a future developer could reference `isCrypto` inside the IIFE thinking it refers to the parameter.

**Recommended fix:** Remove or rename the shadowed variable inside the IIFE.

---

### 1.4 Pump detector only checks BTC trends

**File:** `src/scripts/feed.ts` (~lines 1940–1958)

**Severity:** Medium

The pump detector checks 4 BTC trend timeframes (5m, 15m, 1h, 24h) to block trades during volatile BTC moves. However, it only uses BTC trend data — there's no per-coin pump detection for ETH, SOL, XRP, DOGE, BNB, or HYPE. If ETH pumps 5% in an hour while BTC is flat, the detector won't fire and ETH NO trades could be placed during the pump.

**Recommended fix:** Extend the pump detector to check per-coin price movements using Coinbase data for the relevant coin. At minimum, add ETH/SOL trends.

---

### 1.5 Breakeven trades counted as wins in stats

**File:** `src/app/api/stats/route.ts` (line 101)

**Severity:** Low

Trades with `pnl === 0` (breakeven) are counted as wins (`pnl >= 0`). This inflates the win rate slightly. Whether this is intentional (commented as "breakeven = win, we got our money back") or should be a separate category is a design decision.

**Recommended fix:** Consider tracking breakeven as a third category, or document this as intentional behavior.

---

### 1.6 Kill switch POST upserts with zeroed stats

**File:** `src/app/api/killswitch/route.ts` (lines 67–78)

**Severity:** Medium

When toggling the kill switch, the upsert includes `trades_count: 0, wins: 0, losses: 0`. If a performance row already exists for today with real trade stats, the `onConflict: "date"` upsert will overwrite those fields to zero. This could reset the day's trade tracking.

**Recommended fix:** Only upsert the `kill_switch` column, or use a partial update that doesn't touch `trades_count`, `wins`, `losses`.

---

## 2. Dead Code

### 2.1 `fetchSwarmSignal()` still references Polymarket fields

**File:** `src/app/bot/page.tsx` (lines 80–104)

**Severity:** Low

The dashboard's `fetchSwarmSignal()` function calls `/api/swarm` with `polymarket_id`, `volume_24h`, `liquidity`, and `closes_at` fields. The `/api/swarm` endpoint is disabled (per CLAUDE.md), and these field names are from the old Polymarket integration. This code path is effectively dead — the dashboard now gets signals from Supabase, not from calling `/api/swarm`.

**Recommended fix:** Remove `fetchSwarmSignal()` and the `analyzedIds` state that drives it, or clearly mark as deprecated.

---

### 2.2 Legacy `MAX_TRADE_DOLLARS` constant

**File:** `src/scripts/feed.ts` (~line 108)

**Severity:** Low

`MAX_TRADE_DOLLARS = 1.25` appears to be a legacy constant. The actual trade cap is controlled by `MAX_TRADE_DOLLARS_CAP = 15.00` (used in `calculateTradeSize()`). If `MAX_TRADE_DOLLARS` is unused, it should be removed to avoid confusion.

**Recommended fix:** Grep for usage; if unused, delete it.

---

### 2.3 `_feedStarted` / Polymarket WS in markets route

**File:** `src/app/api/markets/route.ts` (lines 41–53)

**Severity:** Low

The markets API route still attempts to start a Polymarket WebSocket feed (`connectPolymarketFeed()`). Since the project has fully migrated to Kalshi, this is dead code. The `_feedStarted` flag and `ensureFeedRunning()` function serve no purpose and will silently fail in edge runtime anyway.

**Recommended fix:** Remove the Polymarket WS connection attempt. If the markets endpoint still needs to exist, it should only read from Supabase.

---

### 2.4 Whale activity in dashboard

**File:** `src/app/bot/page.tsx` (lines 743–785, and `WhaleRowItem` component)

**Severity:** Low

The dashboard has a full `WhaleRowItem` component and whale-related state (`whales`), but whale data comes from the old Polymarket integration. With the Kalshi-only pivot, whale data is likely always empty. The component still renders if data exists.

**Recommended fix:** Remove or hide the whale section unless Kalshi whale tracking is planned.

---

## 3. Error Handling Gaps

### 3.1 Silent failures across all dashboard data loaders

**File:** `src/app/bot/page.tsx` (lines 901–938)

**Severity:** Low

`loadBtc`, `loadBalance`, `loadPositions`, and `loadStats` all have `catch { /* Silent fail */ }` blocks. If any of these APIs consistently fail (e.g., expired Kalshi key), the user gets stale data with no indication of failure. Only `loadMarkets` sets an `error` state.

**Recommended fix:** Add a secondary error indicator (e.g., "Stale data" badge or last-updated timestamp) so users know when API calls are failing.

---

### 3.2 Balance API exposes debug data in production

**File:** `src/app/api/balance/route.ts` (lines 23–26, 185–202)

**Severity:** Medium

The balance endpoint returns a `debug` object containing `apiKeyPrefix`, `privateKeyLength`, `privateKeyStart` (first 30 chars of the private key!), `rawPositionSample`, `rawMarketResponse`, etc. This is useful for development but leaks sensitive information in production.

**Recommended fix:** Strip the `debug` field in production responses, or gate it behind a `NODE_ENV !== "production"` check.

---

### 3.3 No retry logic for Kalshi API calls in positions enrichment

**File:** `src/app/api/positions/route.ts` (lines 97–165)

**Severity:** Low

Each open position triggers an individual `kalshiFetch` to get market details. If any single call fails, the position falls back to defaults (50% YES, no close time). There's no retry logic. With many positions, transient network errors could leave multiple positions with stale data.

**Recommended fix:** Add a single retry with short delay for failed market detail fetches, or batch-fetch market data if the Kalshi API supports it.

---

## 4. Performance

### 4.1 N+1 API calls in positions route

**File:** `src/app/api/positions/route.ts` (lines 97–218)

**Severity:** Medium

For each open position, the route makes an individual `kalshiFetch` to `/markets/{ticker}`. With 20 open positions, that's 20 separate Kalshi API calls in parallel. This could hit Kalshi rate limits and increases response latency.

**Recommended fix:** Check if Kalshi supports batch market lookup (e.g., `/markets?tickers=X,Y,Z`). If not, consider caching market data with a short TTL.

---

### 4.2 N+1 API calls in balance route

**File:** `src/app/api/balance/route.ts` (lines 91–122)

**Severity:** Medium

Same pattern as positions — each position triggers a `getMarketByTicker()` call for title enrichment. The balance endpoint also makes 3 Supabase queries (trades, signals, trade history) sequentially after the position enrichment.

**Recommended fix:** The positions API already provides enriched position data. Consider having the dashboard use the positions API instead of the balance API for position data, eliminating the duplicate enrichment.

---

### 4.3 Dashboard polls 6 endpoints on overlapping intervals

**File:** `src/app/bot/page.tsx` (lines 947–968)

**Severity:** Low

The dashboard sets up 6 intervals: markets (30s), BTC (5s), kill switch (60s), balance (60s), positions (30s), stats (60s). The balance and positions endpoints both fetch position data from Kalshi, resulting in redundant API calls. With positions already providing portfolio summary, the balance endpoint's position enrichment is duplicated work.

**Recommended fix:** Consolidate balance + positions into a single poll, or have the dashboard use positions data for the portfolio header and balance only for cash balance.

---

### 4.4 `checkAndSellPositions()` makes 3 API calls per position

**File:** `src/scripts/feed.ts`

**Severity:** Medium

The take-profit/stop-loss checker fetches market data per position (Kalshi), checks Supabase for the trade record, and may submit a sell order. With many open positions, this runs every cycle and creates substantial API overhead.

**Recommended fix:** Batch-fetch current market prices where possible, and cache Supabase trade records locally in the feed process.

---

## 5. Constants Audit

### 5.1 Dashboard EXEC uses different sizing than feed

**File:** `src/app/api/trade/route.ts` (lines 14, 103–104)

**Severity:** High

The dashboard manual EXEC button uses `MAX_TRADE_SIZE = 10` and `5% of balance`. The autonomous feed uses `MAX_TRADE_DOLLARS_CAP = 15` and `POSITION_SIZE_PCT = 0.03 (3%)`. This means a manual EXEC trade could be significantly larger than what the bot would place autonomously.

| Constant | trade/route.ts (EXEC) | feed.ts (Auto) |
|---|---|---|
| Max trade | $10 | $15 |
| Position sizing | 5% of balance | 3% of balance |

With a $309 balance: EXEC = min($15.45, $10) = $10, Auto = min($9.27, $15) = $9.27. The difference is moderate now but grows with balance.

**Recommended fix:** Align the constants, or import them from a shared config file.

---

### 5.2 CLAUDE.md has stale values

**File:** `CLAUDE.md`

**Severity:** Medium (affects Cowork context accuracy)

Several values in CLAUDE.md are outdated compared to actual code:

| Field | CLAUDE.md says | Actual code |
|---|---|---|
| NO sweet spot | 68–82¢ | 68–85¢ (feed.ts) |
| BTC min distance | $150 | $100 (feed.ts ternary) |
| Balance | ~$94+ | ~$309 |
| MAX_TRADE_DOLLARS_CAP | $5.00 | $15.00 |

**Recommended fix:** Update CLAUDE.md to match actual code values.

---

### 5.3 `STARTING_BALANCE = 21.78` is stale

**File:** `src/app/api/balance/route.ts` (line 13)

**Severity:** Low

The balance API computes P&L as `totalPortfolioValue - STARTING_BALANCE`. After the $100 deposit, the starting balance reference should be updated to reflect total deposits ($121.78). The current value makes P&L look artificially high.

**Recommended fix:** Update `STARTING_BALANCE` to reflect total deposits, or track deposits separately in Supabase.

---

### 5.4 Guardrails status bar in dashboard is stale

**File:** `src/app/bot/page.tsx` (~line 1297)

**Severity:** Low

The guardrails status bar reads: "Min conf: 67% | Min gap: 10% | Price: 2¢–98¢ | Vol: 500+ | Kill: −20% | No sports | No same-day expiry". Several of these are inaccurate:
- Volume threshold is 1000+ for crypto (not 500+)
- "No same-day expiry" is wrong — crypto markets ARE same-day
- "No sports" is correct but incomplete (should say crypto-only)
- Price range is 10¢–55¢ in the sweet spot filter, not 2¢–98¢

**Recommended fix:** Update the guardrails bar to reflect actual filter values.

---

## 6. Dashboard / UI Gaps

### 6.1 BTC 5-Min Panel shows liquidation data

**File:** `src/app/bot/page.tsx` (lines 46–57)

**Severity:** Low

The `Btc5MinData` interface includes a `liquidation` object with `totalUsd`, `tradeCount`, `signalActive`, and `confidence`. This data comes from Binance WebSocket liquidation feeds, which may not be connected (the feed runs on Mac, not the dashboard). If the `/api/btc5min` endpoint returns empty/stale liquidation data, the panel may show misleading information.

**Recommended fix:** Show "N/A" or hide the liquidation section when data is stale/empty.

---

### 6.2 Paper/Live toggle uses localStorage

**File:** `src/app/bot/page.tsx` (lines 800–804)

**Severity:** Low

The paper/live mode toggle persists to `localStorage`. This is a client-side-only setting. The feed.ts bot runs independently with `PAPER_MODE = false`. The dashboard toggle only affects manual EXEC trades. This could confuse users who think toggling "LIVE" on the dashboard means the bot is live (it already is, independently).

**Recommended fix:** Add a note on the dashboard that the toggle only affects manual EXEC trades, not the autonomous bot.

---

### 6.3 "WS CONNECTED" indicator is misleading

**File:** `src/app/bot/page.tsx` (line 1454)

**Severity:** Low

The markets panel shows "WS CONNECTED" based on `isConnected()` from the Polymarket library. Since the project uses Kalshi REST polling (not WebSocket), this indicator is always false or misleading.

**Recommended fix:** Remove the WS CONNECTED indicator or replace it with a "Last poll: X seconds ago" timestamp.

---

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 8 |
| Low | 12 |

**Top 3 priorities:**

1. **Align EXEC vs auto-exec trade sizing** (High) — prevents unexpected large manual trades
2. **Add KXHYPED to all coinMaps** (Medium) — quick fix across 3 files, immediate UX improvement
3. **Strip debug data from balance API in production** (Medium) — security concern with private key prefix exposure

**Quick wins (< 5 min each):**
- Add KXHYPED to coinMaps (3 files)
- Add KXETH15M to ticker parsers (3 files)
- Update CLAUDE.md stale values
- Update guardrails status bar text
- Remove "WS CONNECTED" indicator
