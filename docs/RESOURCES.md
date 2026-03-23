# RESOURCES

## Primary APIs (Active)
- Kalshi API docs: trading-api.readme.io/reference
- Kalshi markets endpoint: GET /markets?series_ticker=KXBTCD&status=open&limit=200
- Kalshi events endpoint: GET /events?status=open&with_nested_markets=true&limit=200
- Kalshi positions: GET /portfolio/positions?settlement_status=unsettled
- Kalshi balance: GET /portfolio/balance
- Coinbase price API: api.coinbase.com/v2/prices/BTC-USD/spot (free, no key)
- Claude API: docs.anthropic.com/en/docs
- Supabase: supabase.com/docs

## PolyBot API Endpoints (polybot-app.pages.dev)
- GET /api/balance — live balance + positions from Kalshi
- GET /api/killswitch — check kill switch status
- POST /api/killswitch — toggle kill switch (body: {"active": true/false})
- GET /api/markets — recent signals from Supabase
- POST /api/trade — manual trade execution

## Crypto Series (Kalshi)
- KXBTCD — BTC hourly above/below
- KXBTC15M — BTC 15-minute up/down
- KXETHD — ETH hourly above/below
- KXSOLD — SOL hourly above/below

## Reference (Historical)
- Polymarket API docs: docs.polymarket.com (no longer used — switched to Kalshi Sprint 7)
- Polymarket SDK GitHub: github.com/Polymarket/py-clob-client
- OpenRouter API: openrouter.ai
- Binance WebSocket: binance.com/en/support/faq/ws
- Polymarket Analytics: polymarketanalytics.com
- Polyburg leaderboard: polyburg.com
- Polycue strategies: polycue.xyz
- Olas Polystrat agent: olas.network
- DeFi Rate tracker: defirate.com/prediction-markets
- CoinDesk AI agents article: coindesk.com/tech/2026/03/15/ai-agents-are-quietly-rewriting-prediction-market-trading
- MoonDev Framework: youtube.com/@moondevonyt
