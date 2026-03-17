# DATA MODEL - Supabase Schema
Table markets: id polymarket_id title category current_price volume_24h liquidity closes_at status
Table signals: id market_id strategy claude_vote gpt4o_vote gemini_vote consensus confidence ai_probability market_price price_gap reasoning acted_on
Table trades: id signal_id market_id direction entry_price exit_price shares entry_cost exit_value pnl pnl_pct strategy status entry_at exit_at hold_hours
Table rebates: id date usdc_earned markets_count volume
Table performance: id date starting_balance ending_balance trades_count wins losses win_rate pnl_day pnl_cumulative rebates_earned drawdown_pct kill_switch
