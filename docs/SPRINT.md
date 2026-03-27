# PolyBot — Sprint Tracker

## Sprint 1: Foundation — COMPLETE ✅
**Dates:** Mar 17–19
**Goal:** Project scaffolding, core types, API routes, dashboard shell, deploy to Cloudflare

| Deliverable | Status |
|-------------|--------|
| src/lib/types.ts — 15 TypeScript interfaces | ✅ COMPLETE |
| src/lib/polymarket.ts — WebSocket client | ✅ COMPLETE |
| src/lib/supabase.ts — Full CRUD all 5 tables | ✅ COMPLETE |
| src/app/api/markets/route.ts — markets API | ✅ COMPLETE |
| src/app/api/swarm/route.ts — Claude-only AI swarm | ✅ COMPLETE |
| src/app/bot/page.tsx — dashboard UI | ✅ COMPLETE |
| Cloudflare Pages deploy | ✅ COMPLETE |

**Deployed:** polybot-app.pages.dev

---

## Sprint 2: Supabase + Config — COMPLETE ✅
**Dates:** Mar 19
**Goal:** Database schema, env vars, docs alignment

| Deliverable | Status |
|-------------|--------|
| supabase/migrations/001_initial_schema.sql — 5 tables | ✅ COMPLETE |
| SQL migration ran in Supabase SQL Editor | ✅ COMPLETE |
| Anthropic API key added to Cloudflare | ✅ COMPLETE |
| Supabase keys added to Cloudflare | ✅ COMPLETE |
| supabase.ts rewritten for Sprint 2 schema | ✅ COMPLETE |
| markets/route.ts rewritten for Sprint 2 schema | ✅ COMPLETE |
| bot/page.tsx rewritten for Sprint 2 schema | ✅ COMPLETE |
| PolyBot generalized — configurable domain/categories | ✅ COMPLETE |

---

## Sprint 3: BTC 5-Min + Dashboard Rewrite — COMPLETE ✅
**Dates:** Mar 19
**Goal:** BTC liquidation strategy, full dashboard rewrite, live deploy

| Deliverable | Status |
|-------------|--------|
| src/lib/btc5min.ts — Binance liquidation feed | ✅ COMPLETE |
| src/app/api/btc5min/route.ts — BTC 5-min endpoint | ✅ COMPLETE |
| src/app/bot/page.tsx — full dashboard rewrite | ✅ COMPLETE |
| Live at polybot-app.pages.dev/bot | ✅ COMPLETE |
| BTC countdown timer working | ✅ COMPLETE |
| Liquidation progress meter working | ✅ COMPLETE |
| Paper trade mode active | ✅ COMPLETE |

---

## Sprint 4: Wire Real Data Feeds — COMPLETE ✅
**Dates:** Mar 19
**Goal:** Connect live Polymarket data, fire real AI signals, populate dashboard

| Deliverable | Status |
|-------------|--------|
| src/lib/polymarket.ts — Polymarket WS feed with filters | ✅ COMPLETE |
| src/app/api/markets/route.ts — live markets + whales from Supabase | ✅ COMPLETE |
| src/app/api/swarm/route.ts — Claude signals with strategy classification | ✅ COMPLETE |
| src/app/bot/page.tsx — wired to live data (polls every 30s) | ✅ COMPLETE |
| src/scripts/feed.ts — standalone local data ingestion script | ✅ COMPLETE |
| whale_activity table created in Supabase | ✅ COMPLETE |
| Personal references removed from codebase | ✅ COMPLETE |
| General strategy framework in swarm prompt | ✅ COMPLETE |

**Key Discovery — Sprint 4:**
Cloudflare Workers are STATELESS — they spin up for a request and die. Cannot hold persistent WebSocket connections. Solution: feed.ts runs locally (or on Railway), connects to Polymarket WS, saves trades to Supabase. Dashboard reads from Supabase every 30 seconds.

---

## Sprint 5: Signal Intelligence — COMPLETE ✅
**Dates:** Mar 19
**Goal:** Get Claude signals flowing end-to-end, dashboard showing real votes

| Deliverable | Status |
|-------------|--------|
| Sports filter expanded (3 rounds: NBA, NFL, UFC, golf, baseball, Masters, World Series, Spread, Commodores, Bulldogs, NCAA, PGA, Stanley Cup, championship, ATS) | ✅ COMPLETE |
| Whale Watch UUIDs fixed → shows market titles | ✅ COMPLETE |
| Claude analysis moved inline in feed.ts (bypasses Cloudflare edge timeout) | ✅ COMPLETE |
| Category gate removed (was blocking 90% of markets) | ✅ COMPLETE |
| API key workspace mismatch fixed | ✅ COMPLETE |
| 15-second timeout on Claude SDK calls | ✅ COMPLETE |
| Startup self-test added to feed.ts (verifies Supabase + Claude before trading) | ✅ COMPLETE |
| RLS policy fixed (signals table now accepts inserts) | ✅ COMPLETE |
| Switched feed.ts to SUPABASE_SERVICE_ROLE_KEY | ✅ COMPLETE |
| Signal History section live on dashboard | ✅ COMPLETE |

**Key Milestone — Sprint 5:**
- 50 real signals generated in one session ✅
- First real signal: Iranian regime NO at 85% confidence ✅
- Full pipeline working end-to-end: Polymarket WS → feed.ts (Mac) → Claude → Supabase → Dashboard ✅

**Key Discovery — Sprint 5:**
Supabase anon key is read-only when RLS is enabled. Feed script must use SUPABASE_SERVICE_ROLE_KEY with `auth: { autoRefreshToken: false, persistSession: false }` to bypass RLS and write signals. Claude analysis must run inline in feed.ts on Mac — Cloudflare Workers timeout at 8 seconds, not enough for Claude API calls.

---

## Sprint 6: Kalshi + Telegram — COMPLETE ✅
**Dates:** Mar 20
**Goal:** Wire Kalshi API, Telegram alerts, trade execution from dashboard

| Deliverable | Status |
|-------------|--------|
| src/lib/kalshi.ts — Kalshi REST client with RSA-PSS signing (Web Crypto) | ✅ COMPLETE |
| src/lib/telegram.ts — Telegram alert system (signal, trade, P&L, kill switch) | ✅ COMPLETE |
| src/app/api/trade/route.ts — Trade execution endpoint (edge runtime) | ✅ COMPLETE |
| src/app/api/balance/route.ts — Kalshi balance endpoint (edge runtime) | ✅ COMPLETE |
| src/scripts/feed.ts — Telegram signal alerts on actionable signals | ✅ COMPLETE |
| src/app/bot/page.tsx — Execute button + Kalshi balance display | ✅ COMPLETE |
| All 8 secrets configured (local + Cloudflare) | ✅ COMPLETE |
| Telegram bot live (@Polybotsalerts_bot) | ✅ COMPLETE |
| Kalshi API wired with RSA auth | ✅ COMPLETE |
| Execute button on dashboard (LIVE mode only) | ✅ COMPLETE |
| Kill switch wired + tested | ✅ COMPLETE |

**Key Milestone — Sprint 6:**
- All 8 env vars configured: ANTHROPIC, KALSHI (key+RSA), SUPABASE (3), TELEGRAM (2) ✅
- Telegram alerts firing on phone for every signal ≥67% conf + ≥10% gap ✅
- Kalshi API uses RSA-PSS private key signing (NOT API Secret) ✅
- Paper trade gate on every order path ✅
- Position sizing: 5% of balance, max $10 per trade ✅

---

## Sprint 7: First Real Money — COMPLETE ✅
**Dates:** Mar 20
**Goal:** Switch to Kalshi, fix pipeline, place first real trade

| Task | Status |
|------|--------|
| Full pre-trade audit (docs/AUDIT2.md) | ✅ COMPLETE |
| Switched data source from Polymarket to Kalshi | ✅ COMPLETE |
| Fixed RSA private key newline normalization (dotenv) | ✅ COMPLETE |
| Fixed price field mapping (last_price_dollars) | ✅ COMPLETE |
| Fixed yesPrice parseFloat bug (string → number) | ✅ COMPLETE |
| Fixed status filter (active vs open) | ✅ COMPLETE |
| Removed fuzzy market search (same platform = not needed) | ✅ COMPLETE |
| kalshi_ticker saved directly to Supabase | ✅ COMPLETE |
| EXEC button working with real Kalshi tickers | ✅ COMPLETE |
| 847 Kalshi markets fetching successfully | ✅ COMPLETE |
| Claude analyzing real Kalshi markets | ✅ COMPLETE |
| Disabled /api/swarm to cut Claude API cost | ✅ COMPLETE |
| Volume filter added (100+ minimum) | ✅ COMPLETE |
| Auto-kill-switch at -20% drawdown | ✅ COMPLETE |
| MACD strategy implementation (btc5min.ts) | ✅ COMPLETE |
| **FIRST REAL TRADE PLACED ON KALSHI** | ✅ COMPLETE |
| Position sizing fixed (contracts not dollars) | ✅ COMPLETE |
| Telegram spam fixed (startup alert fires once only) | ✅ COMPLETE |
| COWORK GUARDRAILS added to CLAUDE.md | ✅ COMPLETE |
| Unauthorized trade/test route removed | ✅ COMPLETE |

**Key Milestone — Sprint 7 (March 20, 2026 4:24 PM PT):**
- FIRST REAL TRADE: NO on Elon Musk first trillionaire ✅
- Order ID: 04ca969c-cc4a-4209-8cb9-1502b54137d7
- Cost: $0.16 (1 contract at 16¢)
- Balance remaining: $24.84
- Full pipeline: Kalshi REST → feed.ts (Mac) → Claude → Supabase → Dashboard → EXEC → Kalshi order

**Key Discovery — Sprint 7:**
Polymarket → Kalshi ticker mismatch was causing all EXEC failures. Instead of building fuzzy search, switched entire data source to Kalshi. Same platform for signals AND execution = tickers match = EXEC works immediately. Also: dotenv v17 needs RSA keys wrapped in double quotes with `\n` escapes on a single line — raw multi-line breaks dotenv parsing.

---

## Sprint 7b: Dashboard Polish + Memory — COMPLETE ✅
**Dates:** Mar 21
**Goal:** Ship 19 dashboard fixes, add Claude memory injection, harden guardrails

| # | Task | Status |
|---|------|--------|
| 1 | Open Positions panel — live with market titles, side (YES/NO), exposure, resting orders | ✅ COMPLETE |
| 2 | Positions: side regression fixed, $NaN fixed, ticker→title resolution fixed | ✅ COMPLETE |
| 3 | P&L / Win Rate — wired to live Kalshi + Supabase data, polls every 30s | ✅ COMPLETE |
| 4 | Signal History — UUIDs replaced with market titles via Supabase FK join, scroll height 600px | ✅ COMPLETE |
| 5 | Confidence anchoring — Claude prompt updated with 6-tier calibration scale (10-25 / 25-40 / 40-55 / 55-70 / 70-85 / 85-100), removed 'don't be overconfident' anchor | ✅ COMPLETE |
| 6 | Kill Switch confirm modal — styled dark modal, shows position count, Cancel + Confirm Kill buttons, Escape/outside-click to dismiss | ✅ COMPLETE |
| 7 | EXEC threshold visibility — subtitle under Markets & Signals header, tooltip on EXEC button with actual conf/gap/strategy values | ✅ COMPLETE |
| 8 | Markets filter tabs — All / EXEC / LIVE / NO_TRADE with live counts, 20-item cap on All, no cap on filtered tabs | ✅ COMPLETE |
| 9 | Memory injection — buildMemoryContext() runs once per poll cycle, injects open positions + recent losses + win patterns into every Claude signal analysis call | ✅ COMPLETE |
| 10 | Risk/exposure summary bar — green/yellow/red color-coded, shows total deployed $, % of balance, position count, largest position | ✅ COMPLETE |
| 11 | Telegram alert status — header shows 'Last alert: Xm ago' color-coded green/yellow/red, queries most recent YES/NO signal from Supabase | ✅ COMPLETE |
| 12 | Guardrails status row — shows all 8 active guardrails with exact threshold values from feed.ts | ✅ COMPLETE |
| 13 | P&L sparkline — SVG sparkline in Total P&L card, queries last 10 resolved trades for cumulative trend, green/red/gray | ✅ COMPLETE |
| 14 | Signal reasoning expand — click any Signal History card to expand/collapse full Claude reasoning, chevron indicator | ✅ COMPLETE |
| 15 | Whale Watch timestamps — hover shows exact timestamp via title attribute | ✅ COMPLETE |
| 16 | LIVE badge pulse — CSS @keyframes livePulse animation on the orange dot | ✅ COMPLETE |
| 17 | USDC Rebates tooltip — info icon with 'Earned from providing liquidity on executed trades' | ✅ COMPLETE |
| 18 | Text contrast global fix — all muted secondary text bumped from rgba low-opacity to #94a3b8 | ✅ COMPLETE |
| 19 | Security fix — GUARDRAIL #8 added (no curl/API push), revoked exposed GitHub token, new token in .env.local | ✅ COMPLETE |

**Files modified:**
- src/app/bot/page.tsx (all 17 dashboard fixes)
- src/app/api/balance/route.ts (P&L stats, lastAlertAt, pnlHistory)
- src/lib/supabase.ts (Signal History FK join)
- src/scripts/feed.ts (confidence calibration, memory injection)
- CLAUDE.md (GUARDRAIL #8)

---

## Sprint 8: Autonomous Trading — COMPLETE ✅
**Dates:** Mar 22
**Goal:** Make bot fully autonomous with risk management, position exits, and daily limits

| # | Task | Status |
|---|------|--------|
| 1 | Fix #1: Tiered expiry filter — 180 day hard cap, dynamic confidence thresholds (67/72/78%) by days remaining, markets sorted by daysLeft ascending | ✅ COMPLETE |
| 2 | Fix #2: Auto EXEC — bot places orders autonomously via autoExecTrade() in feed.ts, fetches live ask price, places limit orders via kalshiFetch | ✅ COMPLETE |
| 3 | Fix #3: Position sizing — MAX_POSITIONS=8, MIN_BALANCE_FLOOR=$5, MAX_TRADE_DOLLARS=$1.25 | ✅ COMPLETE |
| 4 | Fix #4: Skip BTC price range markets — silently filtered before analysis loop (saves 40+ Claude calls/cycle) | ✅ COMPLETE |
| 5 | Fix #5: Auto sell take-profit — checkAndSellPositions() runs every poll cycle, sells at +25% gain | ✅ COMPLETE |
| 6 | Fix #6: Stop loss — sells at -40% loss, shared sell block with take-profit, 3-way decision (profit/loss/hold) | ✅ COMPLETE |
| 7 | Fix #7: Daily P&L cap — getDailyPnL() blocks new trades at +$3 target or -$5 loss limit. BTC log noise silenced. | ✅ COMPLETE |

**Key Milestone — Sprint 8:**
- Bot is fully autonomous: PAPER_MODE=false, live trading active
- 7 safety mechanisms: expiry filter, position cap, balance floor, trade cost cap, take-profit, stop-loss, daily P&L cap
- All changes in src/scripts/feed.ts only

**Files modified:**
- src/scripts/feed.ts (all 7 fixes)
- CLAUDE.md (sprint status update)

---

## Sprint 9: Crypto-Only Pivot + Safety — COMPLETE ✅
**Dates:** Mar 22–23
**Goal:** Crypto-only pivot, safety filters, smart memory, pump detection, API cost reduction

| # | Task | Status |
|---|------|--------|
| 11 | Volume filter 500→100 | ✅ COMPLETE |
| 12 | Live Coinbase prices injected into Claude prompt | ✅ COMPLETE |
| 13-16 | Crypto market discovery (correct endpoint: /markets?series_ticker=) | ✅ COMPLETE |
| 17 | Min proximity filter (BTC $250, ETH $20, SOL $2) | ✅ COMPLETE |
| 18 | Max distance filter (BTC $3000, ETH $150, SOL $10) | ✅ COMPLETE |
| 19 | Clean CRYPTO PASS logs (moved after distance filter) | ✅ COMPLETE |
| 20 | Supabase trade tracking for crypto markets (isCrypto flag) | ✅ COMPLETE |
| 21 | BTC min distance lowered $500→$250 | ✅ COMPLETE |
| 22 | Dashboard balance uses totalPortfolioValue (cash + positions) | ✅ COMPLETE |
| 23 | Dashboard hides zero-exposure settled positions | ✅ COMPLETE |
| 24 | YES price sweet spot filter 10c-50c for crypto | ✅ COMPLETE |
| 25 | Direction filter — block NO trades where threshold < current price | ✅ COMPLETE |
| 26 | Open position count from Kalshi API (not stale Supabase data) | ✅ COMPLETE |
| 27 | Telegram trade execution alerts | ✅ COMPLETE |
| 28 | Overnight block (2am-6am ET) + BTC 5m trend guard | ✅ COMPLETE |
| 29 | Smart memory — Claude learns win/loss patterns by coin, time, trend | ✅ COMPLETE |
| 30 | Smart pump detector — 3-signal (5m/1h/24h) replaces single trend guard | ✅ COMPLETE |
| 31 | Skip Claude on non-crypto markets — saves ~20+ API calls/cycle | ✅ COMPLETE |
| 32 | 4th pump signal — btcTrend15m > 0.8% (steady 15-min climb) | ✅ COMPLETE |
| KS | Kill switch API toggle fix (was hardcoded to always activate) | ✅ COMPLETE |

**Key Milestones — Sprint 9:**
- Crypto-only pivot: KXBTCD, KXBTC15M, KXETHD, KXSOLD only
- 7-layer filter pipeline: overnight → pump detector (4 signals) → volume → distance → direction → YES price → Claude
- Smart memory system: 5 new Supabase columns, pattern analysis by coin/time/trend
- API cost reduced from ~$2.50/day to ~$0.20-0.30/day (Fix #31)
- 4-signal pump detector: 5m >0.5%, 15m >0.8%, 1h >1.5%, 24h >3%

**Performance Day 3 (March 23, 2026):**
- 7 wins: 3pm BTC x3 ($71,200/$71,300/$71,400) + 11am BTC x4 ($71,800/$72,100/$72,200/$72,400)
- 2 ETH losses (overnight pump): $2,090 + $2,130
- 1 open: BTC Friday $70,900 (expires Mar 27 5pm ET)
- Current balance: $21.65 | Cash: $21.19
- Estimated win rate: ~65-70% overall

**API Key Fix:**
- Switched from polybot-2 key (defendml workspace, exhausted) to new key in Default workspace
- Root cause: credits added to Default workspace but polybot-2 was in defendml workspace

**Files modified:**
- src/scripts/feed.ts (all fixes)
- src/app/api/killswitch/route.ts (toggle fix)
- src/app/api/balance/route.ts (portfolio value fix)
- src/app/bot/page.tsx (dashboard fixes #22-#23)
- CLAUDE.md, README.md, docs/RESOURCES.md (documentation)
- Supabase: 5 new columns on trades table (hour_et, btc_trend_at_entry, coin, threshold_distance, outcome)

---

## Sprint 10: Market Expansion + Cleanup — COMPLETE ✅
**Dates:** Mar 24
**Goal:** Expand crypto universe, tune pump detector, silence log spam

| # | Task | Status |
|---|------|--------|
| 33 | Raise 24h pump threshold 3% → 5% (was blocking trades all day from yesterday's pump) | ✅ COMPLETE |
| 34 | Silence orphaned position warnings (⚠️ spam every 30s for legacy positions) | ✅ COMPLETE |
| 35 | Add XRP trading (KXXRPD) + remove dead KXBTCW/KXETHW endpoints | ✅ COMPLETE |
| 36 | Add DOGE + BNB trading (KXDOGED, KXBNBD) with Coinbase price feeds | ✅ COMPLETE |

**Key Milestones — Sprint 10:**
- Crypto universe expanded: 4 series → 7 series (added XRP, DOGE, BNB)
- Crypto markets: 566 → 901 (+59% more trading opportunities)
- 24h pump threshold relaxed: 3% → 5% (5m/15m/1h signals already catch live pumps)
- Orphaned position log spam eliminated (silent skip for pre-auto-exec positions)
- Dead endpoints removed: KXBTCW/KXETHW don't exist (weekly BTC/ETH use KXBTCD/KXETHD series)
- DOGE/BNB Coinbase prices fail-open (won't break if unavailable)
- 6 live Coinbase price feeds: BTC, ETH, SOL, XRP, DOGE, BNB

**Current System State (March 24, 2026):**
- Balance: $17.96 cash | $21.66 portfolio
- 5 open positions: BTC NO $71,800/$72,050/$72,300/$72,550 (today 5pm ET) + BTC NO $70,900 (Friday)
- 10 API queries per cycle: 3 /events + 7 /markets?series_ticker=
- 4-signal pump detector: 5m >0.5%, 15m >0.8%, 1h >1.5%, 24h >5%
- API burn rate: ~$0.20-0.30/day

**Files modified:**
- src/scripts/feed.ts (all 4 fixes)

---

## Sprint 11: Trading Intelligence — COMPLETE ✅
**Dates:** Mar 25
**Goal:** Dynamic position sizing, smart memory from settlements, distance/price tuning

| # | Task | Status |
|---|------|--------|
| 10 | Dynamic position sizing — 2% of balance × confidence multiplier, multi-contract orders, dynamic MAX_POSITIONS | ✅ COMPLETE |
| 38 | Smart memory from Kalshi settlements — pulls ALL settled trades (up to 200) for pattern analysis, fallback to Supabase | ✅ COMPLETE |
| 39b | Lower BTC distance $250→$150, raise YES ceiling 50¢→55¢ — catches evening markets previously blocked | ✅ COMPLETE |

**Key Milestones — Sprint 11:**
- **Dynamic position sizing LIVE:** POSITION_SIZE_PCT=3% of balance (raised from 2%), confidence multiplier (55%→100% scaling), multi-contract orders
- **Constants:** POSITION_SIZE_PCT=0.03, MIN_TRADE=$0.50, MAX_TRADE=$5.00, MAX_POSITIONS dynamic (25% of balance / trade size, floor 8, ceiling 20)
- **Smart memory LIVE:** 14 lines of context per poll cycle from Kalshi settlements API
  - Calculates: overall WR, per-coin WR, BTC threshold bands, momentum (last 10), biggest wins/losses, recent losses
  - Fallback to Supabase trades table if Kalshi fetch fails or returns < 3 results
- **Distance + YES ceiling tuned:** MIN_BTC_DISTANCE $250→$150, MAX_YES_PRICE 50¢→55¢

**Performance (March 25, 2026 EOD):**
- Portfolio: ~$92-94 (bankroll deposited: $100)
- 57 settled trades | 75.4% win rate (43W/14L)
- Sweet spot analysis:
  - 68-80¢ band: 88% WR, +$1.90 profit (17 trades) ← TARGET
  - 81-90¢ band: 69% WR, -$4.10 loss (26 trades) ← NOW BLOCKED by Fix #39
  - 55-67¢ band: 44% WR, -$1.90 loss ← NOW BLOCKED by Fix #39

**Files modified:**
- src/scripts/feed.ts (all 3 fixes)

---

## Sprint 12: Sweet Spot Filter + Dashboard — COMPLETE ✅
**Dates:** Mar 25
**Goal:** Data-driven price filter, dashboard rebuild, position sizing

| # | Task | Status |
|---|------|--------|
| 8 | Dashboard rebuild — portfolio header, open positions w/ verdicts, stats bar w/ real Kalshi P&L, recent trades log | ✅ COMPLETE |
| 39 | NO price sweet spot filter 68-82¢ only (YES 18-32¢) — blocks losing 81-90¢ and 55-67¢ bands | ✅ COMPLETE |
| — | Position size raised: POSITION_SIZE_PCT 0.02 → 0.03 (fewer trades = bigger size) | ✅ COMPLETE |
| — | 3 dashboard bugs: win/loss calc (>=0 = WIN), ticker strike parsing, crypto-only market filter | ✅ COMPLETE |

**Key Milestones — Sprint 12:**
- **NO sweet spot filter LIVE:** Only trade NO at 68-82¢ (YES 18-32¢)
  - 68-80¢ band: 88% WR, +$1.90 profit (17 trades) ← KEEP
  - 81-90¢ band: 69% WR, -$4.10 loss (26 trades) ← BLOCKED
  - 55-67¢ band: 44% WR, -$1.90 loss ← BLOCKED
- **Position size raised:** 2% → 3% of balance per trade (fewer high-quality trades, bigger size each)
- **Dashboard rebuild LIVE:** polybot-app.pages.dev/bot
  - Portfolio header (value, cash, positions)
  - Open positions with verdicts (likely WIN / coin flip / at risk)
  - Stats bar with real Kalshi P&L (57 trades, 75.4% WR)
  - Recent trades log from Kalshi settlements
  - Crypto-only Markets & Signals (no more politics/economics)
  - Strike price parsing: KXBTCD-26MAR2513-T71199.99 → "BTC $71,200 · 1pm ET"
- **New API routes:** /api/positions (Kalshi balance + open positions + verdicts), /api/stats (settled trades + P&L)
- **8-layer filter pipeline now:** overnight → pump → volume → distance → YES range → NO sweet spot → direction → Claude

**Performance (March 25, 2026 EOD):**
- Portfolio: ~$92-94 (bankroll deposited: $100)
- 57 settled trades | 75.4% WR (43W/14L)
- Strategy validated: NO trades in 68-82¢ band = highest WR + positive P&L

**Files modified:**
- src/scripts/feed.ts (Fix #39 sweet spot + position size)
- src/app/api/positions/route.ts (NEW — Kalshi positions + verdicts)
- src/app/api/stats/route.ts (NEW — Kalshi settled trades + P&L)
- src/app/api/markets/route.ts (crypto-only filter)
- src/app/bot/page.tsx (full dashboard rebuild)
- src/lib/kalshi.ts (export kalshiFetch for API routes)

---

## Sprint 13: Strategy Hardening + Coin Expansion — COMPLETE ✅
**Dates:** Mar 26
**Goal:** Ban losing YES trades, add HYPE coin, update to 24/7 trading

| # | Task | Status |
|---|------|--------|
| 37 | Ban YES trades entirely — hard block at auto-exec (0% WR, 3 trades, -$0.52) | ✅ COMPLETE |
| — | Add HYPE coin (KXHYPED) — 7th coin, Coinbase fail-open, all 12 integration points | ✅ COMPLETE |
| — | Add WIF coin (KXWIFD) then REMOVE — price $0.19 too low for sweet spot trades | ✅ COMPLETE (reverted) |
| — | Overnight block update — 2am-6am daily → Thu 3-5am ET only (Kalshi 24/7 since Aug 2025) | ✅ COMPLETE |

**Key Milestones — Sprint 13:**
- **YES trades permanently banned:** If Claude returns YES → log skip + return. Only NO trades execute.
- **HYPE coin LIVE:** KXHYPED series, Coinbase HYPE-USD (optional/fail-open), all filter/memory/exec paths wired
- **WIF lesson learned:** Added as 8th coin assuming $2.50 price → actual price $0.19 → too cheap for sweet spot → removed same session. **Key lesson: always verify live price before adding coins.**
- **24/7 trading enabled:** Kalshi moved to 24/7 on Aug 7, 2025. Only scheduled maintenance Thu 3-5am ET. Old 2am-6am nightly block was leaving money on the table.
- **7 coins active:** BTC, ETH, SOL, XRP, DOGE, BNB, HYPE
- **8 market series:** KXBTCD, KXBTC15M, KXETHD, KXSOLD, KXXRPD, KXDOGED, KXBNBD, KXHYPED

**Mar 26 5pm ET Settlement — STRATEGY VALIDATED:**
- BTC settled at $68,950
- 4/4 NO positions WON (100% on sweet spot trades):
  - $71,200 NO x3 = $3.00 ✅
  - $71,450 NO x3 = $3.00 ✅
  - $72,200 NO x3 = $3.00 ✅
  - $72,450 NO x3 = $3.00 ✅
- Total payout: $12.00 | Net profit: +$2.48

**Performance (March 26, 2026 EOD):**
- Portfolio: ~$94+ (bankroll deposited: $100)
- 60+ settled trades | ~75-80% WR
- Sweet spot 68-82¢ = 88% WR CONFIRMED with Mar 26 results

**Files modified:**
- src/scripts/feed.ts (Fix #37 YES ban, HYPE coin, WIF add+remove, overnight block update)

---

## Sprint 14: Scaling — BACKLOG 📋
**Goal:** Scale trade sizes and add time-based intelligence

| # | Task | Status |
|---|------|--------|
| 40 | Time-of-day memory patterns — morning vs evening, weekday vs weekend WR (after 200+ trades) | ⬜ NOT STARTED |
| 9 | Win rate by strategy — breakdown showing which strategies perform best | ⬜ NOT STARTED |
| — | Increase POSITION_SIZE_PCT 3%→5% (after $150 balance + 100 sweet spot trades validated) | ⬜ NOT STARTED |
| — | Increase MAX_TRADE_CAP $5→$8 (when balance hits $250+) | ⬜ NOT STARTED |

**Future Backlog (unscheduled):**
- Research new coins with verified live prices before adding
- Implement MACD(6/26/5) strategy on BTC 1-min candles
- Wire Binance liquidation WebSocket feed
- Combine MACD + liquidation = 85% confidence signal
- RBI framework: Research → Backtest → Incubate → Scale
- Validate 200+ trades → scale capital
- Build PolyBot SaaS subscription tier
- Kalshi US app migration eval
