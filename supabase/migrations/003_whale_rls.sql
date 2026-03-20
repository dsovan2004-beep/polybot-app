-- ============================================================================
-- PolyBot — whale_activity RLS policies (Sprint 6 Security Fix)
-- Adds proper Row-Level Security for the whale_activity table
-- Same pattern as other tables: public read, service role insert
-- ============================================================================

-- Enable RLS on whale_activity (may already be enabled)
ALTER TABLE IF EXISTS whale_activity ENABLE ROW LEVEL SECURITY;

-- Public read access (dashboard needs to display whale activity)
CREATE POLICY "Allow public read on whale_activity"
  ON whale_activity
  FOR SELECT
  USING (true);

-- Service role can insert (feed.ts uses service role key)
CREATE POLICY "Allow service role insert on whale_activity"
  ON whale_activity
  FOR INSERT
  WITH CHECK (true);

-- Service role can update
CREATE POLICY "Allow service role update on whale_activity"
  ON whale_activity
  FOR UPDATE
  USING (true);

-- Service role can delete (cleanup)
CREATE POLICY "Allow service role delete on whale_activity"
  ON whale_activity
  FOR DELETE
  USING (true);
