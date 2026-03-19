# THE PLAYBOOK - Execution Framework

## Strategies (user-selectable)

### Strategy 1: Maker Bot
Place limit orders both YES and NO, earn spread plus USDC rebates daily.
Always MAKER — never TAKER. feeRateBps required in every order signature.

### Strategy 2: AI News Lag
Breaking news creates 30sec to 5min window before market reprices.
Claude analyzes news sentiment, finds information edges the market is slow to react to.

### Strategy 3: Logical Arbitrage — DEAD ❌
Math errors across correlated markets. In theory zero risk guaranteed profit.
In practice: spreads too tight, not enough volume to execute profitably.

### Strategy 4: BTC 5-Min Liquidation Bounce
How it works:
1. Connect Binance liquidation WebSocket (free, no API key):
   wss://fstream.binance.com/ws/!forceOrder@arr
2. Track BTC LONG liquidations in rolling 60-second window
3. When $500K+ cumulative liquidation detected → BUY UP signal
4. Confidence scales with liquidation size:
   - $500K-$1M = 0.65
   - $1M-$2M = 0.75
   - $2M+ = 0.85
5. Place as MAKER limit order only (earn rebates)
6. Exit forced at 5-minute window close
7. Market slug is deterministic (no search needed):
   window_ts = floor(now/300)*300
   slug = btc-updown-5m-{window_ts}
   close_time = window_ts + 300

## AI Swarm — Claude-only, 3 parallel perspectives

Changed from 3-model swarm (Claude+GPT-4o+Gemini) to Claude-only.
Only requires ANTHROPIC_API_KEY — no OpenRouter, no GPT-4o, no Gemini.

3 parallel Claude calls with different system prompts:
- Vote 1: Probability Analyst — historical base rates, statistical patterns, reference class forecasting
- Vote 2: News Analyst — breaking news, sentiment shifts, information edges not yet priced in
- Vote 3: Risk Analyst — downside risks, contrarian view, reasons consensus might be wrong

## Consensus Rules
- 2 of 3 votes must agree AND confidence must be 67% or higher to signal
- Price gap must be >= 10% (abs(ai_probability - market_price) > 0.10)
- Outputs: YES / NO / NO_TRADE
- If both conditions not met → NO_TRADE regardless of vote

## Polymarket WebSocket — Live Data Feed

Connection: wss://ws-subscriptions-clob.polymarket.com/ws/market

Subscription format:
```json
{
  "type": "subscribe",
  "channel": "activity",
  "market": "orders_matched"
}
```

Filter rules (from MoonDev research):
- Skip if price < 0.02 or > 0.98 (near resolution — skip)
- Skip if usd_amount < $500
- Skip sports keywords: NBA, NFL, UFC, football, basketball, soccer
- Re-analyze markets every 8 hours
- All trades >= $500 that pass filters → whale_activity table

## Configurable Settings (per user)
- Domain expertise: injected into swarm system prompts via `userDomain` param
- Market categories: user selects which to track
- Strategy toggle: enable/disable each strategy independently
- Confidence threshold: adjustable (default 67%, min 50%)
- Kill switch threshold: adjustable (default -20% in 24h)
