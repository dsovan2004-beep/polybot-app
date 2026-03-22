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

## Phase 9 — Dashboard Intelligence: IN PROGRESS 🔄
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
| Data Feeds | ✅ Live | Kalshi REST polling every 30s, 847 markets |
| Feed | ✅ Running | Mac terminal (feed.ts with self-test + Telegram) |
| Signals | ✅ Flowing | Claude analyzing real Kalshi markets |
| First Trade | ✅ Placed | March 20, 2026 4:24 PM PT |
