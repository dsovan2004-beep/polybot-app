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

## BTC 5-Min Strategy Rules
9. Binance liquidation feed is FREE and public — no API key needed
10. No API key needed for ANY WebSocket data (Binance or Polymarket)
11. $500K long liquidation in 60s window = BUY UP signal
12. Confidence scales: $500K-$1M=0.65, $1M-$2M=0.75, $2M+=0.85
13. Always MAKER orders — earn rebates, never pay fees
14. Market slug is deterministic: btc-updown-5m-{floor(now/300)*300}
15. Exit forced at 5-min window close

## General Product Rules
16. PolyBot is a general-purpose tool for ANY Polymarket trader
17. No hardcoded personal context — all user-configurable
18. Users select their own market categories
19. Users configure their domain expertise for AI swarm prompts
20. Strategy selection is user preference — enable/disable per strategy
21. Your edge is YOUR domain knowledge — PolyBot amplifies it

## Strategy Status (Validated)
| Strategy | Status |
|----------|--------|
| BTC Liquidation Bounce | VALIDATED ✅ |
| Maker/LP Bot | VALIDATED ✅ |
| AI News Lag | VALIDATED ✅ |
| Pure Arbitrage | DEAD ❌ |
| REST Polling | DEAD ❌ |
