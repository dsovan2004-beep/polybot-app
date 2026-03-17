-- ============================================================================
-- PolyBot — Initial Database Schema (Sprint 2)
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. markets
-- ---------------------------------------------------------------------------

CREATE TABLE markets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polymarket_id   TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL,
  current_price   DECIMAL(5,4),
  volume_24h      DECIMAL(12,2),
  liquidity       DECIMAL(12,2),
  closes_at       TIMESTAMPTZ,
  status          TEXT DEFAULT 'active',
  resolved_value  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_markets_category ON markets(category);
CREATE INDEX idx_markets_status ON markets(status);
CREATE INDEX idx_markets_closes_at ON markets(closes_at);
CREATE INDEX idx_markets_polymarket_id ON markets(polymarket_id);

-- ---------------------------------------------------------------------------
-- 2. signals
-- ---------------------------------------------------------------------------

CREATE TABLE signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID REFERENCES markets(id),
  strategy        TEXT NOT NULL,
  claude_vote     TEXT,
  gpt4o_vote      TEXT,
  gemini_vote     TEXT,
  consensus       TEXT,
  confidence      INTEGER,
  ai_probability  DECIMAL(5,4),
  market_price    DECIMAL(5,4),
  price_gap       DECIMAL(5,4),
  reasoning       TEXT,
  acted_on        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_market_id ON signals(market_id);
CREATE INDEX idx_signals_strategy ON signals(strategy);
CREATE INDEX idx_signals_consensus ON signals(consensus);
CREATE INDEX idx_signals_confidence ON signals(confidence DESC);
CREATE INDEX idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX idx_signals_acted_on ON signals(acted_on);

-- ---------------------------------------------------------------------------
-- 3. trades
-- ---------------------------------------------------------------------------

CREATE TABLE trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       UUID REFERENCES signals(id),
  market_id       UUID REFERENCES markets(id),
  direction       TEXT NOT NULL,
  entry_price     DECIMAL(5,4),
  exit_price      DECIMAL(5,4),
  shares          DECIMAL(12,4),
  entry_cost      DECIMAL(12,2),
  exit_value      DECIMAL(12,2),
  pnl             DECIMAL(12,2),
  pnl_pct         DECIMAL(8,4),
  strategy        TEXT,
  status          TEXT DEFAULT 'open',
  entry_at        TIMESTAMPTZ DEFAULT NOW(),
  exit_at         TIMESTAMPTZ,
  hold_hours      DECIMAL(8,2),
  notes           TEXT
);

CREATE INDEX idx_trades_market_id ON trades(market_id);
CREATE INDEX idx_trades_signal_id ON trades(signal_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_strategy ON trades(strategy);
CREATE INDEX idx_trades_entry_at ON trades(entry_at DESC);
CREATE INDEX idx_trades_open ON trades(status) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- 4. rebates
-- ---------------------------------------------------------------------------

CREATE TABLE rebates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE UNIQUE NOT NULL,
  usdc_earned     DECIMAL(12,6),
  markets_count   INTEGER,
  volume          DECIMAL(12,2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rebates_date ON rebates(date DESC);

-- ---------------------------------------------------------------------------
-- 5. performance
-- ---------------------------------------------------------------------------

CREATE TABLE performance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE UNIQUE NOT NULL,
  starting_balance  DECIMAL(12,2),
  ending_balance    DECIMAL(12,2),
  trades_count      INTEGER DEFAULT 0,
  wins              INTEGER DEFAULT 0,
  losses            INTEGER DEFAULT 0,
  win_rate          DECIMAL(5,4),
  pnl_day           DECIMAL(12,2),
  pnl_cumulative    DECIMAL(12,2),
  rebates_earned    DECIMAL(12,6),
  drawdown_pct      DECIMAL(5,4),
  kill_switch       BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_performance_date ON performance(date DESC);
CREATE INDEX idx_performance_kill_switch ON performance(kill_switch) WHERE kill_switch = TRUE;

-- ---------------------------------------------------------------------------
-- Auto-update updated_at trigger (for markets)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE markets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance ENABLE ROW LEVEL SECURITY;

-- Authenticated users get full access
CREATE POLICY "auth_all_markets"     ON markets     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_signals"     ON signals     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_trades"      ON trades      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_rebates"     ON rebates     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_performance" ON performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon gets read-only on markets and performance
CREATE POLICY "anon_read_markets"     ON markets     FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_performance" ON performance FOR SELECT TO anon USING (true);

-- Service role gets full access (for API routes)
CREATE POLICY "service_all_markets"     ON markets     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_signals"     ON signals     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_trades"      ON trades      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_rebates"     ON rebates     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_performance" ON performance FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Enable Supabase Realtime on key tables
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE trades;
ALTER PUBLICATION supabase_realtime ADD TABLE signals;
ALTER PUBLICATION supabase_realtime ADD TABLE performance;
