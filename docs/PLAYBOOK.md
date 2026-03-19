# THE PLAYBOOK - Execution Framework

## Strategies (user-selectable)
Strategy 1: Maker Bot — place limit orders both YES and NO, earn spread plus USDC rebates daily
Strategy 2: AI News Lag — breaking news creates 30sec to 5min window before market reprices
Strategy 3: Logical Arbitrage — math errors across correlated markets, zero risk guaranteed profit

## AI Swarm — Claude-only, 3 parallel perspectives
Vote 1: Claude as Probability Analyst — historical base rates, statistical patterns, reference class forecasting
Vote 2: Claude as News Analyst — breaking news, sentiment shifts, information edges the market hasn't priced in
Vote 3: Claude as Risk Analyst — downside risks, contrarian view, reasons the consensus might be wrong

## Consensus Rules
- 2 of 3 votes must agree AND confidence must be 67% or higher to signal
- Outputs: YES / NO / NO_TRADE
- Only requires ANTHROPIC_API_KEY

## Configurable Settings (per user)
- Domain expertise: user provides their background (e.g. "finance", "biotech", "politics", "crypto")
  - Injected into all 3 analyst system prompts dynamically
  - Passed as `userDomain` parameter to POST /api/swarm
  - If not provided, swarm runs as a generalist with no domain bias
- Market categories: user selects which Polymarket categories to track
- Strategy toggle: enable/disable each strategy independently
- Confidence threshold: adjustable (default 67%, min 50%)
- Kill switch threshold: adjustable (default -20% in 24h)
