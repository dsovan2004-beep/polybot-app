# polybot-app
PolyBot — AI-powered Kalshi crypto trading bot

Autonomous trading bot that analyzes Kalshi prediction markets using Claude AI with live Coinbase prices for real-time edge detection.

## Strategy (Sprint 9 — Crypto-Only)
- Trades ONLY crypto short-term markets: KXBTCD, KXBTC15M, KXETHD, KXSOLD
- Live Coinbase prices (BTC, ETH, SOL, XRP) injected into every Claude analysis
- 5-layer filter pipeline: volume → distance → YES price → direction → Claude confidence
- Distance filters: BTC $250-$3,000, ETH $20-$150, SOL $2-$10
- YES price sweet spot: 10c-50c only (NO pays 50c-90c = best risk/reward)
- Direction filter: only NO trades on thresholds ABOVE current price
- Position count live from Kalshi API (not stale DB data)

## Stack
- Next.js 15 + Cloudflare Workers (dashboard)
- Supabase (signals, trades, markets, performance)
- Claude API (market analysis via Haiku)
- Kalshi REST API (market data + order execution)
- Coinbase API (live crypto prices)
- Telegram alerts (@Polybotsalerts_bot)

## Performance
- Day 1: $21.78 → $25.36 (+$3.58, +16.4% ROI, 6/6 wins = 100%)
- Day 2: 2 ETH trades placed, 3 open positions
- Current balance: $25.25
- Site: polybot-app.pages.dev
