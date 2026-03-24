# DATA MODEL - Supabase Schema (6 Tables)

## Table: markets
id UUID PRIMARY KEY, polymarket_id TEXT UNIQUE, title TEXT, category TEXT, current_price DECIMAL(5,4), volume_24h DECIMAL(12,2), liquidity DECIMAL(12,2), closes_at TIMESTAMPTZ, status TEXT DEFAULT 'active', resolved_value TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ

## Table: signals
id UUID PRIMARY KEY, market_id UUID REFERENCES markets(id), strategy TEXT, claude_vote TEXT, gpt4o_vote TEXT, gemini_vote TEXT, consensus TEXT, confidence INTEGER, ai_probability DECIMAL(5,4), market_price DECIMAL(5,4), price_gap DECIMAL(5,4), reasoning TEXT, acted_on BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ

## Table: trades
id UUID PRIMARY KEY, signal_id UUID REFERENCES signals(id), market_id UUID REFERENCES markets(id), direction TEXT, entry_price DECIMAL(5,4), exit_price DECIMAL(5,4), shares DECIMAL(12,4), entry_cost DECIMAL(12,2), exit_value DECIMAL(12,2), pnl DECIMAL(12,2), pnl_pct DECIMAL(8,4), strategy TEXT, status TEXT DEFAULT 'open', entry_at TIMESTAMPTZ, exit_at TIMESTAMPTZ, hold_hours DECIMAL(8,2), notes TEXT, hour_et INTEGER, btc_trend_at_entry DECIMAL(8,4), coin TEXT, threshold_distance DECIMAL(12,2), outcome TEXT

### Sprint 9 New Columns (added via ALTER TABLE)
- **hour_et** INTEGER — hour of trade in Eastern Time (0–23), used for time-window pattern analysis
- **btc_trend_at_entry** DECIMAL(8,4) — BTC 5-min trend % at time of trade entry
- **coin** TEXT — which coin was traded (BTC, ETH, SOL, XRP, DOGE, BNB, or OTHER)
- **threshold_distance** DECIMAL(12,2) — dollar distance between Kalshi threshold and live coin price at entry
- **outcome** TEXT — "win" or "loss", set on settlement by checkAndSellPositions()

## Table: rebates
id UUID PRIMARY KEY, date DATE UNIQUE, usdc_earned DECIMAL(12,6), markets_count INTEGER, volume DECIMAL(12,2), created_at TIMESTAMPTZ

## Table: performance
id UUID PRIMARY KEY, date DATE UNIQUE, starting_balance DECIMAL(12,2), ending_balance DECIMAL(12,2), trades_count INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, win_rate DECIMAL(5,4), pnl_day DECIMAL(12,2), pnl_cumulative DECIMAL(12,2), rebates_earned DECIMAL(12,6), drawdown_pct DECIMAL(5,4), kill_switch BOOLEAN DEFAULT FALSE

## Table: whale_activity (added Sprint 4)
id UUID PRIMARY KEY, market_id UUID REFERENCES markets(id) ON DELETE CASCADE, wallet_address TEXT, trade_size_usd DECIMAL(12,2), direction TEXT, price_at_trade DECIMAL(5,4), created_at TIMESTAMPTZ DEFAULT NOW()

## Sprint 7b Usage Notes (No Schema Changes)
No new tables or columns added. Existing tables queried:
- signals: market_id (FK join to markets.title), consensus, confidence, reasoning, created_at — used for Signal History title resolution, Telegram alert timestamp, filter tabs
- trades: pnl, status, created_at — used for P&L sparkline (cumulative over last 10 resolved), win rate calculation
- markets: title — joined via signals.market_id FK for dashboard display

## Sprint 8 Usage Notes (No Schema Changes)
trades table is now actively used by feed.ts autonomous trading:
- INSERT (autoExecTrade): market_id, direction, entry_price, shares, entry_cost, strategy, status='open', notes
- UPDATE (checkAndSellPositions): status='closed', exit_price, exit_value, pnl, pnl_pct, exit_at, notes — triggered by take-profit (+25%) or stop-loss (-40%)
- SELECT (getDailyPnL): SUM(pnl) WHERE status='closed' AND exit_at >= today UTC start — blocks new trades at +$3 or -$5 daily limit
- SELECT (checkAndSellPositions): trades.entry_cost, trades.direction via markets.polymarket_id → trades.market_id FK join
- NOTE: 5 manual positions placed before auto-exec (Sprint 7) have no Supabase trade records — checkAndSellPositions() logs a warning and skips them gracefully

## Sprint 9 Usage Notes (5 New Columns on trades)
Added 5 columns to trades table via ALTER TABLE for smart memory and trade learning:
- INSERT (autoExecTrade): now also writes hour_et, btc_trend_at_entry, coin, threshold_distance
- UPDATE (checkAndSellPositions): now also writes outcome ("win" or "loss") on settlement
- SELECT (buildMemoryContext): queries last 50 closed trades with outcome for pattern analysis
  - Groups by coin → win rate per coin (BTC/ETH/SOL/XRP/DOGE/BNB)
  - Groups by hour_et → win rate by time window (9am-5pm / 5pm-11pm / 11pm-9am ET)
  - Groups by btc_trend_at_entry → win rate flat (≤0.3%) vs rising (>0.3%)
  - Recent 3 losses with coin, hour, trend for avoid-repeat learning
- performance table: kill_switch column used by POST /api/killswitch toggle (keyed by date)

## Sprint 10 Usage Notes (No Schema Changes)
No new tables or columns. Changes to feed.ts data flow only:
- autoExecTrade() coin detection expanded: KXXRPD→"XRP", KXDOGED→"DOGE", KXBNBD→"BNB"
- fetchLiveCryptoPrices() now fetches 6 coins (BTC, ETH, SOL, XRP + optional DOGE, BNB)
- DOGE/BNB are fail-open: if Coinbase fetch fails, they default to 0 (required coins still must succeed)
- Orphaned position warnings silenced (checkAndSellPositions no longer logs ⚠️ for missing Supabase records)

## Feed Script Data Flow (feed.ts) — Sprint 10 Updated
- Polls Kalshi REST API every 30 seconds: 3x GET /events + 7x GET /markets?series_ticker= (KXBTCD, KXBTC15M, KXETHD, KXSOLD, KXXRPD, KXDOGED, KXBNBD)
- Fetches ~2,016 markets total (~1,115 general + ~901 crypto)
- Fetches live Coinbase prices: BTC, ETH, SOL, XRP (required) + DOGE, BNB (optional, fail-open) + 4 BTC trend timeframes (5m/15m/1h/24h)
- **Crypto-only hard block:** non-crypto markets never reach Claude (Fix #31)
- **5-layer crypto filter pipeline:**
  1. Volume: crypto ≥ 1,000
  2. Distance: BTC $250–$3,000, ETH $20–$150, SOL $2–$10, XRP/DOGE $2–$10, BNB $20–$150 from current price
  3. YES price: 10c–50c sweet spot only
  4. Direction: threshold must be ABOVE current price
  5. Claude: 67% minimum confidence with live prices injected
- **Safety guards (before filters):**
  - Overnight block: 2am–6am ET hard skip
  - 4-signal pump detector: 5m >0.5%, 15m >0.8%, 1h >1.5%, 24h >5%
- Saves qualifying markets to markets table (upsert on polymarket_id = kalshi_ticker)
- Claude analyzes crypto-only inline → saves signals to signals table
- buildMemoryContext() queries Kalshi positions + last 50 closed trades for pattern learning
- autoExecTrade() places live Kalshi orders → saves trades with 5 context fields
- checkAndSellPositions() runs every cycle → auto-sells at +25% or -40%, writes outcome
- getDailyPnL() blocks new trades at +$3 profit or -$5 loss daily cap
- Telegram alerts on trade execution and settlement
- Position count from Kalshi API (filtered by market_exposure_dollars > 0)

## Deployment Notes
- feed.ts runs on Mac terminal: `caffeinate -i npx ts-node src/scripts/feed.ts`
- Dashboard deployed on Cloudflare Pages: polybot-app.pages.dev
- Environment variables in .env.local (local) + Cloudflare Variables and Secrets (production)
- 8 env vars configured: ANTHROPIC_API_KEY, KALSHI_API_KEY, KALSHI_PRIVATE_KEY, SUPABASE (3), TELEGRAM (2)
