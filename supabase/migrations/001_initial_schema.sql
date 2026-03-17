-- ============================================================================
-- PolyBot — Initial Database Schema
-- Supabase / PostgreSQL
-- Matches src/lib/types.ts interfaces exactly
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE market_category AS ENUM ('ai_tech', 'politics');
CREATE TYPE strategy_name AS ENUM ('maker_bot', 'ai_news_lag', 'logical_arbitrage');
CREATE TYPE trading_mode AS ENUM ('paper', 'live');
CREATE TYPE side AS ENUM ('yes', 'no');
CREATE TYPE bot_status AS ENUM ('idle', 'running', 'paused', 'killed', 'error');
CREATE TYPE ai_provider AS ENUM ('claude', 'openrouter');
CREATE TYPE order_status AS ENUM ('pending', 'open', 'filled', 'partially_filled', 'cancelled', 'expired', 'rejected');
CREATE TYPE market_status AS ENUM ('active', 'closed', 'resolved', 'paused');
CREATE TYPE whale_alert_type AS ENUM ('large_trade', 'position_flip', 'new_entry', 'full_exit');
CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high');

-- ---------------------------------------------------------------------------
-- 1. markets
-- ---------------------------------------------------------------------------

CREATE TABLE markets (
  id              TEXT PRIMARY KEY,
  condition_id    TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  question        TEXT NOT NULL,
  description     TEXT DEFAULT '',
  category        market_category NOT NULL,
  status          market_status NOT NULL DEFAULT 'active',
  outcomes        TEXT[2] NOT NULL DEFAULT '{"Yes","No"}',
  outcome_prices  NUMERIC(10,6)[2] NOT NULL DEFAULT '{0.5,0.5}',
  volume          NUMERIC(18,2) NOT NULL DEFAULT 0,
  liquidity       NUMERIC(18,2) NOT NULL DEFAULT 0,
  spread_bps      INTEGER NOT NULL DEFAULT 0,
  end_date        TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_markets_category ON markets(category);
CREATE INDEX idx_markets_status ON markets(status);
CREATE INDEX idx_markets_end_date ON markets(end_date);
CREATE INDEX idx_markets_volume ON markets(volume DESC);

-- ---------------------------------------------------------------------------
-- 2. signals
-- ---------------------------------------------------------------------------

CREATE TABLE signals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id       TEXT NOT NULL REFERENCES markets(id),
  strategy_name   strategy_name NOT NULL,
  side            side NOT NULL,
  confidence      NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  suggested_price NUMERIC(10,6) NOT NULL,
  suggested_size  NUMERIC(18,2) NOT NULL,
  reasoning       TEXT NOT NULL DEFAULT '',
  ai_provider     ai_provider NOT NULL,
  model_id        TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signals_market ON signals(market_id);
CREATE INDEX idx_signals_strategy ON signals(strategy_name);
CREATE INDEX idx_signals_confidence ON signals(confidence DESC);
CREATE INDEX idx_signals_created ON signals(created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. trades
-- ---------------------------------------------------------------------------

CREATE TABLE trades (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        TEXT NOT NULL,
  market_id       TEXT NOT NULL REFERENCES markets(id),
  strategy_name   strategy_name NOT NULL,
  side            side NOT NULL,
  price           NUMERIC(10,6) NOT NULL,
  size            NUMERIC(18,2) NOT NULL,
  filled_size     NUMERIC(18,2) NOT NULL DEFAULT 0,
  avg_fill_price  NUMERIC(10,6),
  status          order_status NOT NULL DEFAULT 'pending',
  mode            trading_mode NOT NULL DEFAULT 'paper',
  pnl             NUMERIC(18,6),
  fees            NUMERIC(18,6) NOT NULL DEFAULT 0,
  ai_confidence   NUMERIC(5,4) NOT NULL CHECK (ai_confidence >= 0.67),
  ai_reasoning    TEXT NOT NULL DEFAULT '',
  signal_id       UUID REFERENCES signals(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ
);

CREATE INDEX idx_trades_market ON trades(market_id);
CREATE INDEX idx_trades_strategy ON trades(strategy_name);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_mode ON trades(mode);
CREATE INDEX idx_trades_created ON trades(created_at DESC);
CREATE INDEX idx_trades_open ON trades(status, closed_at) WHERE closed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. rebates
-- ---------------------------------------------------------------------------

CREATE TABLE rebates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id        UUID NOT NULL REFERENCES trades(id),
  market_id       TEXT NOT NULL REFERENCES markets(id),
  amount          NUMERIC(18,6) NOT NULL,
  rebate_rate     NUMERIC(10,6) NOT NULL,
  tier            TEXT NOT NULL DEFAULT 'standard',
  earned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rebates_trade ON rebates(trade_id);
CREATE INDEX idx_rebates_market ON rebates(market_id);
CREATE INDEX idx_rebates_earned ON rebates(earned_at DESC);

-- ---------------------------------------------------------------------------
-- 5. performance (rolling snapshots)
-- ---------------------------------------------------------------------------

CREATE TABLE performance (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  total_pnl             NUMERIC(18,6) NOT NULL DEFAULT 0,
  realized_pnl          NUMERIC(18,6) NOT NULL DEFAULT 0,
  unrealized_pnl        NUMERIC(18,6) NOT NULL DEFAULT 0,
  total_trades          INTEGER NOT NULL DEFAULT 0,
  win_rate              NUMERIC(5,4) NOT NULL DEFAULT 0,
  avg_confidence        NUMERIC(5,4) NOT NULL DEFAULT 0,
  total_volume          NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_rebates         NUMERIC(18,6) NOT NULL DEFAULT 0,
  sharpe_ratio          NUMERIC(10,4),
  max_drawdown_percent  NUMERIC(8,4) NOT NULL DEFAULT 0,
  drawdown_percent_24h  NUMERIC(8,4) NOT NULL DEFAULT 0,
  equity                NUMERIC(18,2) NOT NULL DEFAULT 0,
  exposure              NUMERIC(18,2) NOT NULL DEFAULT 0,
  open_position_count   INTEGER NOT NULL DEFAULT 0,
  kill_switch_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  period_start          TIMESTAMPTZ NOT NULL,
  period_end            TIMESTAMPTZ NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_performance_period ON performance(period_end DESC);
CREATE INDEX idx_performance_killswitch ON performance(kill_switch_triggered) WHERE kill_switch_triggered = TRUE;

-- ---------------------------------------------------------------------------
-- 6. whale_activity
-- ---------------------------------------------------------------------------

CREATE TABLE whale_activity (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id           TEXT NOT NULL REFERENCES markets(id),
  wallet_address      TEXT NOT NULL,
  side                side NOT NULL,
  size                NUMERIC(18,2) NOT NULL,
  price               NUMERIC(10,6) NOT NULL,
  total_position      NUMERIC(18,2) NOT NULL DEFAULT 0,
  historical_accuracy NUMERIC(5,4),
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_whale_market ON whale_activity(market_id);
CREATE INDEX idx_whale_wallet ON whale_activity(wallet_address);
CREATE INDEX idx_whale_size ON whale_activity(size DESC);
CREATE INDEX idx_whale_detected ON whale_activity(detected_at DESC);

-- ---------------------------------------------------------------------------
-- 7. whale_alerts
-- ---------------------------------------------------------------------------

CREATE TABLE whale_alerts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whale_activity_id UUID NOT NULL REFERENCES whale_activity(id),
  market_id         TEXT NOT NULL REFERENCES markets(id),
  alert_type        whale_alert_type NOT NULL,
  severity          alert_severity NOT NULL DEFAULT 'low',
  message           TEXT NOT NULL,
  actionable        BOOLEAN NOT NULL DEFAULT FALSE,
  suggested_side    side,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_whale_alerts_market ON whale_alerts(market_id);
CREATE INDEX idx_whale_alerts_severity ON whale_alerts(severity);
CREATE INDEX idx_whale_alerts_created ON whale_alerts(created_at DESC);

-- ---------------------------------------------------------------------------
-- 8. swarm_votes
-- ---------------------------------------------------------------------------

CREATE TABLE swarm_votes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  swarm_session_id  UUID NOT NULL,
  market_id         TEXT NOT NULL REFERENCES markets(id),
  provider          ai_provider NOT NULL,
  model_id          TEXT NOT NULL,
  predicted_side    side NOT NULL,
  confidence        NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasoning         TEXT NOT NULL DEFAULT '',
  key_factors       TEXT[] DEFAULT '{}',
  latency_ms        INTEGER NOT NULL DEFAULT 0,
  voted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_swarm_votes_session ON swarm_votes(swarm_session_id);
CREATE INDEX idx_swarm_votes_market ON swarm_votes(market_id);

-- ---------------------------------------------------------------------------
-- 9. swarm_results
-- ---------------------------------------------------------------------------

CREATE TABLE swarm_results (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id             TEXT NOT NULL REFERENCES markets(id),
  total_models          INTEGER NOT NULL,
  yes_votes             INTEGER NOT NULL,
  no_votes              INTEGER NOT NULL,
  avg_confidence        NUMERIC(5,4) NOT NULL,
  max_confidence        NUMERIC(5,4) NOT NULL,
  min_confidence        NUMERIC(5,4) NOT NULL,
  consensus_reached     BOOLEAN NOT NULL DEFAULT FALSE,
  consensus_side        side,
  consensus_confidence  NUMERIC(5,4),
  dissent               TEXT[] DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_swarm_results_market ON swarm_results(market_id);
CREATE INDEX idx_swarm_results_consensus ON swarm_results(consensus_reached, created_at DESC);

-- ---------------------------------------------------------------------------
-- 10. maker_orders
-- ---------------------------------------------------------------------------

CREATE TABLE maker_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id       TEXT NOT NULL REFERENCES markets(id),
  side            side NOT NULL,
  price           NUMERIC(10,6) NOT NULL,
  size            NUMERIC(18,2) NOT NULL,
  status          order_status NOT NULL DEFAULT 'pending',
  mode            trading_mode NOT NULL DEFAULT 'paper',
  spread_bps      INTEGER NOT NULL DEFAULT 0,
  inventory_skew  NUMERIC(5,4) NOT NULL DEFAULT 0,
  is_refresh      BOOLEAN NOT NULL DEFAULT FALSE,
  placed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  filled_at       TIMESTAMPTZ
);

CREATE INDEX idx_maker_orders_market ON maker_orders(market_id);
CREATE INDEX idx_maker_orders_status ON maker_orders(status);
CREATE INDEX idx_maker_orders_open ON maker_orders(status) WHERE status IN ('pending', 'open');

-- ---------------------------------------------------------------------------
-- 11. bot_state
-- ---------------------------------------------------------------------------

CREATE TABLE bot_state (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status             bot_status NOT NULL DEFAULT 'idle',
  mode               trading_mode NOT NULL DEFAULT 'paper',
  active_strategies  strategy_name[] DEFAULT '{}',
  config             JSONB NOT NULL DEFAULT '{}',
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_markets_updated   BEFORE UPDATE ON markets     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bot_state_updated BEFORE UPDATE ON bot_state   FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- ---------------------------------------------------------------------------

ALTER TABLE markets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE whale_activity  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whale_alerts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_votes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE maker_orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_state       ENABLE ROW LEVEL SECURITY;

-- Service role (server-side) gets full access
CREATE POLICY "service_all" ON markets        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON signals        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON trades         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON rebates        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON performance    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON whale_activity FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON whale_alerts   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON swarm_votes    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON swarm_results  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON maker_orders   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON bot_state      FOR ALL USING (true) WITH CHECK (true);

-- Anon/public gets read-only on safe tables
CREATE POLICY "anon_read_markets"     ON markets       FOR SELECT USING (true);
CREATE POLICY "anon_read_performance" ON performance   FOR SELECT USING (true);
CREATE POLICY "anon_read_whale"       ON whale_alerts  FOR SELECT USING (true);
CREATE POLICY "anon_read_swarm"       ON swarm_results FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- Enable Supabase Realtime on key tables
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE trades;
ALTER PUBLICATION supabase_realtime ADD TABLE signals;
ALTER PUBLICATION supabase_realtime ADD TABLE whale_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE performance;
ALTER PUBLICATION supabase_realtime ADD TABLE bot_state;
