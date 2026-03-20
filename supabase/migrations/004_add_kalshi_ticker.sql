-- ============================================================================
-- PolyBot Migration 004 — Add kalshi_ticker column to markets table
-- Sprint 7: Switch data source from Polymarket to Kalshi
-- Run this in Supabase SQL Editor
-- ============================================================================

ALTER TABLE markets ADD COLUMN IF NOT EXISTS kalshi_ticker TEXT;

-- Index for fast lookups by Kalshi ticker
CREATE INDEX IF NOT EXISTS idx_markets_kalshi_ticker ON markets (kalshi_ticker);

-- Allow RLS reads on kalshi_ticker (anon key can read for dashboard)
-- The existing SELECT policy already covers all columns, so no new policy needed.
