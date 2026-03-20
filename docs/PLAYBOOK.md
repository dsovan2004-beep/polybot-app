# THE PLAYBOOK - Execution Framework

## Architecture Reality

### Cloudflare Limitation Discovered
Cloudflare Workers are request/response only. Cannot hold open WebSocket connections. They spin up, handle one request, and die.

### Solution — Split Architecture
- **feed.ts** = data collector + Claude analyst (runs on Mac terminal)
- **Supabase** = data store (always on, free tier)
- **Dashboard** = display layer (Cloudflare Pages, static + edge)
- **API routes** = data retrieval (Cloudflare Workers, stateless)

### Current Working Pipeline (Sprint 7 validated)
```
Mac terminal (feed.ts)
  → polls Kalshi REST API every 30 seconds
  → GET /events?status=open&with_nested_markets=true&limit=200
  → filters: price 0.02-0.98 (last_price_dollars), volume 100+, no sports
  → saves to Supabase (markets table with kalshi_ticker)
  → calls Claude INLINE for each new market
  → saves signal to Supabase (signals table)
  → sends Telegram alert for actionable signals

Dashboard (bot/page.tsx)
  → polls /api/markets every 30 seconds
  → reads signals from Supabase (persisted by feed.ts)
  → displays YES/NO/NO_TRADE badge + confidence %
  → EXEC button uses kalshi_ticker directly (no fuzzy search)
  → /api/trade places order on Kalshi via RSA-PSS signed request
```

### Platform: Kalshi (NOT Polymarket)
- Switched Sprint 7 — same platform for signals AND execution = no ticker mismatch
- Feed polls `GET /events` every 30 seconds (847 markets available)
- `kalshi_ticker` saved directly to Supabase
- EXEC uses `kalshi_ticker` — no fuzzy search needed
- Kalshi is CFTC regulated (legal in US)

---

## Strategies (user-selectable)

### Strategy 1: Maker Bot (LOWEST RISK — START HERE)
Place limit orders both YES and NO, earn spread plus USDC rebates daily.
Always MAKER — never TAKER. feeRateBps required in every order signature.
No prediction needed. Collect daily USDC. Start here.

### Strategy 2: AI News Lag (MEDIUM RISK)
Breaking news creates 30sec to 5min window before market reprices.
Claude analyzes news sentiment, finds information edges the market is slow to react to.

### Strategy 3: Logical Arbitrage — DEAD ❌
Spreads too tight, not enough volume. Don't waste time on this.

### Strategy 4: BTC 5-Min Liquidation Bounce (HIGHER RISK)
1. Connect Binance liquidation WebSocket (free, no API key):
   wss://fstream.binance.com/ws/!forceOrder@arr
2. Track BTC LONG liquidations in rolling 60-second window
3. When $500K+ cumulative liquidation detected → BUY UP signal
4. Confidence scales: $500K-$1M=0.65, $1M-$2M=0.75, $2M+=0.85
5. Place as MAKER limit order only (earn rebates)
6. Exit forced at 5-minute window close
7. Market slug is deterministic: btc-updown-5m-{floor(now/300)*300}

---

## AI Swarm — Claude-only

Claude-only. No OpenRouter, no GPT-4o, no Gemini. Only ANTHROPIC_API_KEY required.

Single Claude call per market with general analyst prompt. Outputs:
- vote: YES / NO / NO_TRADE
- probability: 0.00-1.00
- confidence: 0-100
- reason: one sentence
- strategy: news_lag / sentiment_fade / logical_arb / maker / unknown

### Signal Rules
- NO_TRADE if confidence < 67
- NO_TRADE if price gap < 10% (abs(probability - market_price) < 0.10)
- Signal saved to Supabase signals table regardless of vote

---

## Kalshi REST API — Live Data Feed

Platform: Kalshi (api.elections.kalshi.com)
Auth: RSA-PSS signing (KALSHI_API_KEY + KALSHI_PRIVATE_KEY)
Endpoint: `GET /trade-api/v2/events?status=open&with_nested_markets=true&limit=200`
Poll interval: 30 seconds

### Feed Script Filters (Sprint 7)
- Price: 0.02-0.98 (uses `last_price_dollars`, parseFloat for safety)
- Volume: 100+ minimum (`volume_24h_fp`, kills dead/novelty markets)
- Sports filter (100+ keywords): NBA, NFL, UFC, football, basketball, soccer, MLB, NHL, tennis, boxing, MMA, cricket, rugby, esports, etc.
- No category gate — Claude decides what's tradeable
- Dedup: never analyze same market twice per session (Set)
- Each qualifying market → Supabase markets table (with `kalshi_ticker`)
- Each qualifying market → Claude analysis → Supabase signals table
- Actionable signals → Telegram alert

### Signal Rules (validated Sprint 7)
- Minimum confidence: 67%
- Minimum price gap: 10% (abs(probability - market_price) > 0.10)
- NO_TRADE if below either threshold
- Strategy tagged: news_lag / sentiment_fade / logical_arb / maker / unknown
- Signal saved to Supabase regardless of vote (for tracking)

### Expiry Filter (Sprint 8 target)
- 90 days max — surface near-term markets only
- Fed/crypto/politics markets with near-term resolution = highest edge

---

## Path to First Dollar

### Fastest Path
Maker rebates on BTC 5-min markets. No prediction needed. Place orders both sides. Collect daily USDC.

### Timeline
- **Week 1:** Feed running on Mac, first real trade placed ✅ DONE
- **Month 1:** Validate 30 trades, prove 67%+ win rate
- **Month 2:** Scale to $500 deployed
- **Month 3:** Scale to $1,000 deployed
- **Month 6:** $5,000 deployed + PolyBot SaaS launch
- **Year 2:** $75,000 + 100 SaaS subscribers = $15,000/month

---

## Configurable Settings (per user)
- Domain expertise: injected into swarm prompt via `userDomain` param
- Market categories: user selects which to track
- Strategy toggle: enable/disable each strategy independently
- Confidence threshold: adjustable (default 67%, min 50%)
- Kill switch threshold: adjustable (default -20% in 24h)
