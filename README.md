# polybot-app
PolyBot — AI-powered Kalshi crypto trading bot

Autonomous trading bot that analyzes Kalshi prediction markets using Claude AI with live Coinbase prices for real-time edge detection.

## Strategy (Sprint 9 — Crypto-Only)
- Trades ONLY crypto short-term markets: KXBTCD, KXBTC15M, KXETHD, KXSOLD
- Live Coinbase prices (BTC, ETH, SOL, XRP) injected into every Claude analysis
- Proximity filters prevent dangerous trades near current price
- Distance filters: BTC $250-$3,000, ETH $20-$150, SOL $2-$10

## Stack
- Next.js 15 + Cloudflare Workers (dashboard)
- Supabase (signals, trades, markets)
- Claude API (market analysis)
- Kalshi REST API (market data + order execution)
- Coinbase API (live crypto prices)
- Telegram alerts (@Polybotsalerts_bot)

## Performance (Day 1)
- Starting balance: $21.78
- Current balance: $25.37 (+16.5% ROI)
- Win rate: 3/3 BTC (100%)
- Site: polybot-app.pages.dev
