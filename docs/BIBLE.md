# THE BIBLE - Rules That Never Change

## Core Trading Rules
1. Maker not Taker — earn rebates, zero fees
2. WebSocket only — no REST polling
3. 67% confidence minimum to signal
4. 10% max per trade, 3-5% standard
5. Kill switch at -20% in 24hrs
6. Paper trade first, 30 trades minimum
7. feeRateBps in every order signature (required post Feb 18 2026 rule change)
8. Avoid 45-55% probability zone (max fees)

## Architecture Rules
9. Cloudflare Workers = stateless, no persistent WebSocket connections
10. Feed script (feed.ts) must run on external server (Railway)
11. Dashboard reads from Supabase (not direct WS)
12. Railway free tier = best option for feed hosting (500 hrs/month)
13. Data flow: Railway feed.ts → Supabase → Dashboard

## BTC 5-Min Strategy Rules
14. Binance liquidation feed is FREE and public — no API key needed
15. No API key needed for ANY WebSocket data (Binance or Polymarket)
16. $500K long liquidation in 60s window = BUY UP signal
17. Confidence scales: $500K-$1M=0.65, $1M-$2M=0.75, $2M+=0.85
18. Always MAKER orders — earn rebates, never pay fees
19. Market slug is deterministic: btc-updown-5m-{floor(now/300)*300}
20. Exit forced at 5-min window close

## General Product Rules
21. PolyBot is a general-purpose tool for ANY Polymarket trader
22. No hardcoded personal context — all user-configurable
23. Users select their own market categories
24. Users configure their domain expertise for AI swarm prompts
25. Strategy selection is user preference — enable/disable per strategy

## How PolyBot Makes Money

### Way 1 — Maker Rebates (LOWEST RISK — START HERE)
- Place limit orders BOTH sides of BTC 5-min markets
- Earn USDC rebates daily just for providing liquidity
- Don't need to predict direction
- Validated: ~$200/day per $10K deployed
- With $200 starting capital = $4-8/day

### Way 2 — AI Signal Trades (MEDIUM RISK)
- Claude spots mispriced market (gap > 10%)
- Buy at market price, sell when news prices in
- Target hold: 18-72 hours
- Only trade if confidence >= 67%

### Way 3 — BTC Liquidation Bounce (HIGHER RISK)
- $500K+ BTC longs liquidated in 60s window
- Buy UP on current 5-min market
- Mean reversion after capitulation
- Exit forced at window close (300 seconds)

## Capital Rules
- Start with $200 on Polymarket
- First month: Maker rebates only
- Only scale after 30 validated paper signals
- Never risk more than 10% per trade
- Kill switch at -20% in 24 hours

## Strategy Status (Validated)
| Strategy | Status |
|----------|--------|
| BTC Liquidation Bounce | VALIDATED ✅ |
| Maker/LP Bot | VALIDATED ✅ |
| AI News Lag | VALIDATED ✅ |
| Pure Arbitrage | DEAD ❌ |
| REST Polling | DEAD ❌ |
