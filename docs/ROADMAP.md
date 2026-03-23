# ROADMAP - Build Phases

## Phase 1 — Signal Engine: COMPLETE ✅
- Dashboard live at polybot-app.pages.dev/bot
- All API routes deployed on Cloudflare edge (/api/markets, /api/swarm, /api/btc5min)
- Supabase connected, 6 tables live
- AI Swarm: Claude-only signal analysis
- BTC 5-min liquidation strategy built and deployed

## Phase 2 — P&L Tracker: COMPLETE ✅
- Supabase schema migrated (001_initial_schema.sql)
- 6 tables: markets, signals, trades, rebates, performance, whale_activity
- RLS policies: authenticated full access, anon read-only, service_role full
- Indexes on all frequently queried columns
- Realtime enabled on trades, signals, performance

## Phase 3 — BTC Strategy + Dashboard: COMPLETE ✅
- BTC 5-min liquidation feed (Binance WS)
- Full dashboard rewrite with countdown timer, liquidation meter
- 4 stat cards, signals panel, whale watch
- Paper trade mode active

## Phase 4 — Live Data Feeds: COMPLETE ✅
- Polymarket WS feed deployed (feed.ts)
- Claude signal engine live with strategy classification
- Whale activity tracking live
- Split architecture validated (Mac → Supabase → Dashboard)
- Key discovery: Cloudflare Workers are stateless, cannot hold WS

## Phase 5 — Signal Intelligence: COMPLETE ✅
- 50 signals generated in first live session
- Claude Haiku pipeline (20x cheaper than Sonnet)
- Full end-to-end pipeline working
- Dashboard showing real YES/NO/NO_TRADE votes with confidence %
- Signal History section live
- Sports filter expanded (3 rounds)
- Whale Watch showing market titles (not UUIDs)
- Claude analysis moved inline in feed.ts (bypasses Cloudflare timeout)
- Category gate removed (was blocking 90% of markets)
- Startup self-test verifies pipeline before trading
- RLS policy fixed, service role key for writes

## Phase 6 — Kalshi + Telegram: COMPLETE ✅
- Kalshi REST API client with RSA-PSS signing (Web Crypto, edge-compatible)
- Telegram alert system (signal, trade, P&L, kill switch alerts)
- Trade execution API route (/api/trade) with kill switch + paper gate
- Balance API route (/api/balance) with live Kalshi balance
- Execute button on dashboard (LIVE mode only, with confirm dialog)
- Kalshi balance display in header
- All 8 env vars configured (local + Cloudflare production)
- Telegram bot live (@Polybotsalerts_bot) — alerts firing on phone
- Position sizing: 5% of balance, max $10 per trade

## Phase 7 — First Real Money: COMPLETE ✅
- Switched data source from Polymarket to Kalshi (same platform = EXEC works)
- Fixed RSA key normalization, price field mapping, status filter, parseFloat bug
- 847 Kalshi markets fetching, Claude analyzing in real time
- kalshi_ticker saved directly to Supabase, EXEC uses it directly
- Disabled /api/swarm to cut Claude API cost ($5/day → $0)
- Volume filter: 100+ minimum (kills dead/novelty markets)
- **FIRST REAL TRADE: March 20, 2026 4:24 PM PT** — NO on Elon Musk first trillionaire, 15% price, $1 payout
- Balance: $24.84, 1 open position

## Phase 7b — Dashboard Polish + Memory: COMPLETE ✅
- Dashboard: ALL 19 planned fixes shipped (positions, P&L, filters, sparkline, risk bar, guardrails, expand reasoning, text contrast, pulse animation, tooltips)
- Memory injection: Layer 1 (open positions) live, Layers 2+3 (losses/wins) ready — need resolved trades to populate
- Security: GUARDRAIL #8 added, exposed token revoked and rotated
- Confidence calibration: 6-tier scale replacing 45% anchoring
- Files: page.tsx, balance/route.ts, supabase.ts, feed.ts, CLAUDE.md

## Phase 8 — Autonomous Trading: COMPLETE ✅
- Bot fully autonomous: PAPER_MODE=false, live trading active
- 7 fixes shipped: tiered expiry, auto-exec, position sizing, BTC skip, take-profit (+25%), stop-loss (-40%), daily P&L cap (+$3/-$5)
- Safety stack: MAX_POSITIONS=8, MIN_BALANCE_FLOOR=$5, MAX_TRADE_DOLLARS=$1.25, MAX_EXPIRY_DAYS=180
- checkAndSellPositions() runs every poll cycle (auto exit management)
- getDailyPnL() blocks new trades when daily limits hit
- All changes in feed.ts only — no dashboard or API changes

## Phase 9 — Crypto-Only Pivot + Safety: COMPLETE ✅
- **Crypto-only pivot:** KXBTCD, KXBTC15M, KXETHD, KXSOLD series only
- **22 fixes shipped** (#11–#32) across discovery, filters, safety, memory, and cost
- **5-layer filter pipeline:** volume → distance → YES price → direction → Claude confidence
- **4-signal pump detector:** 5m >0.5%, 15m >0.8%, 1h >1.5%, 24h >3% BTC trend guards
- **Overnight block:** 2am–6am ET hard skip
- **Smart memory:** 50 closed trades → pattern analysis by coin/time/trend
- **Trade context:** 5 new Supabase columns (hour_et, btc_trend_at_entry, coin, threshold_distance, outcome)
- **Telegram trade alerts:** execution + settlement notifications
- **Crypto-only hard block:** non-crypto markets never reach Claude (Fix #31, saves ~$2/day)
- **Live Kalshi position count:** filtered by market_exposure_dollars > 0
- **Direction filter:** threshold must be ABOVE current price
- **YES price sweet spot:** 10c–50c only (NO pays 50c–90c)
- **Live Coinbase prices:** BTC, ETH, SOL, XRP spot + 4 BTC trend timeframes (5m/15m/1h/24h)
- **Kill switch fix:** POST toggle reads request body (was hardcoded to always activate)
- **Performance Day 1:** $21.78 → $25.36 (+$3.58, +16.4% ROI, 6/6 wins = 100%)
- **Performance Day 2:** 2 ETH trades, 3 open positions
- **Performance Day 3:** Balance $25.25, overnight losses stopped, API cost cut 90%
- Files modified: feed.ts, killswitch/route.ts, page.tsx, balance/route.ts

## Phase 10 — Scale + Dashboard Intelligence: QUEUED 📋
- Fix #33: Orphaned positions cleanup (positions in Kalshi but not in Supabase)
- Fix #34: Weekly BTC/ETH markets (KXBTC-W series, longer expiry)
- Fix #8: Trades log dashboard tab (full trade history with P&L per trade)
- Fix #9: Win rate by strategy (breakdown showing which strategies perform best)
- Fix #10: Position sizing by confidence (scale trade size based on confidence level)

### Future Backlog (unscheduled)
- MACD(6/26/5) + Binance liquidation combined strategy
- RBI framework: Research → Backtest → Incubate → Scale
- Validate 30 trades win rate → scale to $100
- Build PolyBot SaaS subscription tier
- Kalshi US app migration eval

### $15K Scaling Roadmap
| Timeline | Capital | Monthly Return |
|----------|---------|----------------|
| Month 1 | $25 → prove win rate | +$5-10 |
| Month 2 | $500 deployed | +$50-100/month |
| Month 3 | $1,000 deployed | +$100-200/month |
| Month 6 | $5,000 deployed | +$500-1,000/month |
| Month 12 | $25,000 deployed | +$2,500-5,000/month |
| Year 2 | $75,000 + SaaS | $15,000/month ✅ |

### PolyBot SaaS Tiers
| Tier | Price | Features |
|------|-------|----------|
| Free | $0/month | 3 signals/day, paper only |
| Pro | $49/month | Unlimited signals |
| Elite | $149/month | Full automation |
| **Target** | **100 Elite subs** | **$14,900/month** |

## Infrastructure
| Service | Status | Details |
|---------|--------|---------|
| GitHub | ✅ Live | github.com/dsovan2004-beep/polybot-app |
| Cloudflare | ✅ Live | polybot-app.pages.dev |
| Supabase | ✅ Live | [SUPABASE_URL_IN_ENV] |
| AI | ✅ Live | Claude Haiku (ANTHROPIC_API_KEY) — 20x cheaper |
| Kalshi | ✅ Live | RSA-PSS signing, CFTC regulated exchange |
| Telegram | ✅ Live | @Polybotsalerts_bot — signal + trade + kill alerts |
| Data Feeds | ✅ Live | Kalshi REST polling every 30s, 1,851 markets (1,285 general + 566 crypto) |
| Coinbase | ✅ Live | BTC/ETH/SOL/XRP spot + 4 BTC trend timeframes (5m/15m/1h/24h) |
| Feed | ✅ Running | Mac terminal (feed.ts with self-test + Telegram + pump detector) |
| Signals | ✅ Flowing | Claude analyzing crypto-only markets with live prices |
| First Trade | ✅ Placed | March 20, 2026 4:24 PM PT |
| Balance | ✅ Tracked | $25.25 (started $21.78, +16.4% Day 1) |
