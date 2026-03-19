# DATA MODEL - Supabase Schema (6 Tables)

## Table: markets
id UUID PRIMARY KEY, polymarket_id TEXT UNIQUE, title TEXT, category TEXT, current_price DECIMAL(5,4), volume_24h DECIMAL(12,2), liquidity DECIMAL(12,2), closes_at TIMESTAMPTZ, status TEXT DEFAULT 'active', resolved_value TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ

## Table: signals
id UUID PRIMARY KEY, market_id UUID REFERENCES markets(id), strategy TEXT, claude_vote TEXT, gpt4o_vote TEXT, gemini_vote TEXT, consensus TEXT, confidence INTEGER, ai_probability DECIMAL(5,4), market_price DECIMAL(5,4), price_gap DECIMAL(5,4), reasoning TEXT, acted_on BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ

## Table: trades
id UUID PRIMARY KEY, signal_id UUID REFERENCES signals(id), market_id UUID REFERENCES markets(id), direction TEXT, entry_price DECIMAL(5,4), exit_price DECIMAL(5,4), shares DECIMAL(12,4), entry_cost DECIMAL(12,2), exit_value DECIMAL(12,2), pnl DECIMAL(12,2), pnl_pct DECIMAL(8,4), strategy TEXT, status TEXT DEFAULT 'open', entry_at TIMESTAMPTZ, exit_at TIMESTAMPTZ, hold_hours DECIMAL(8,2), notes TEXT

## Table: rebates
id UUID PRIMARY KEY, date DATE UNIQUE, usdc_earned DECIMAL(12,6), markets_count INTEGER, volume DECIMAL(12,2), created_at TIMESTAMPTZ

## Table: performance
id UUID PRIMARY KEY, date DATE UNIQUE, starting_balance DECIMAL(12,2), ending_balance DECIMAL(12,2), trades_count INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, win_rate DECIMAL(5,4), pnl_day DECIMAL(12,2), pnl_cumulative DECIMAL(12,2), rebates_earned DECIMAL(12,6), drawdown_pct DECIMAL(5,4), kill_switch BOOLEAN DEFAULT FALSE

## Table: whale_activity (added Sprint 4)
id UUID PRIMARY KEY, market_id UUID REFERENCES markets(id) ON DELETE CASCADE, wallet_address TEXT, trade_size_usd DECIMAL(12,2), direction TEXT, price_at_trade DECIMAL(5,4), created_at TIMESTAMPTZ DEFAULT NOW()

## Feed Script Data Flow (feed.ts)
- Connects to Polymarket WS (wss://ws-live-data.polymarket.com) on startup
- Subscribes to activity/trades topic
- Filters: $500+ USD, no sports keywords, price 0.02-0.98
- Saves qualifying trades to markets table (upsert on polymarket_id)
- Saves $500+ trades to whale_activity table
- Stats logged every 60 seconds to console
- Auto-reconnects on disconnect (code 1006 is normal)

## Railway Deployment Notes
- feed.ts deployed as worker process (not web)
- railway.json + Procfile in project root
- Environment variables mirror .env.local
- Free tier: 500 hours/month (enough for 24/7 single process)
- Required env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
