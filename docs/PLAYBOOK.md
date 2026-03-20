# THE PLAYBOOK - Execution Framework

## Architecture Reality

### Cloudflare Limitation Discovered
Cloudflare Workers are request/response only. Cannot hold open WebSocket connections. They spin up, handle one request, and die.

### Solution — Split Architecture
- **feed.ts** = data collector + Claude analyst (runs on Mac terminal)
- **Supabase** = data store (always on, free tier)
- **Dashboard** = display layer (Cloudflare Pages, static + edge)
- **API routes** = data retrieval (Cloudflare Workers, stateless)

### Current Working Pipeline (Sprint 5 validated)
```
Mac terminal (feed.ts)
  → connects Polymarket WebSocket
  → filters trades ($10+, no sports, 0.02-0.98)
  → saves to Supabase (markets + whale_activity)
  → calls Claude Haiku INLINE for each new market
  → saves signal to Supabase (signals table)

Dashboard (bot/page.tsx)
  → polls /api/markets every 30 seconds
  → reads signals from Supabase (persisted by feed.ts)
  → displays YES/NO/NO_TRADE badge + confidence %
  → shows Signal History section
```

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

## Polymarket WebSocket — Live Data Feed

Connection: wss://ws-live-data.polymarket.com

Subscription format:
```json
{
  "subscriptions": [
    {
      "topic": "activity",
      "type": "trades"
    }
  ]
}
```

### Feed Script Filters
- Minimum trade size: $10 USD
- Skip price < 0.02 or > 0.98 (near resolution)
- Skip sports (expanded keyword list — Sprint 5):
  NBA, NFL, UFC, football, basketball, soccer, MLB, NHL, tennis, boxing, MMA,
  FC, vs., O/U, Open, UEFA, Premier, LaLiga, Bundesliga, Serie A, Ligue 1, MLS,
  Vallecano, Porto, Stuttgart, Samsunspor, Forest, Madrid, Tagger, Seidel,
  Spread, Commodores, Bulldogs, NCAA, PGA, golf, baseball, Masters, World Series,
  Astros, Yankees, Dodgers, tournament, Stanley Cup, championship, ATS, covers
- Dedup: never analyze same market twice per session
- All qualifying trades → markets table
- All qualifying trades → whale_activity table
- Each new market → Claude Haiku analysis → signals table

### Signal Rules (validated Sprint 5)
- Minimum confidence: 67%
- Minimum price gap: 10% (abs(probability - market_price) > 0.10)
- NO_TRADE if below either threshold
- Strategy tagged: news_lag / sentiment_fade / logical_arb / maker / unknown
- Signal saved to Supabase regardless of vote (for tracking)
- 50 signals generated in first live session ✅

### Validation Process
- Week 1: Run feed 2-3 hours/day, manually check each signal, record market + Claude vote + actual outcome. Target: 30 validated signals.
- Week 2: Calculate win rate. If 67%+ → go live on Kalshi. If below → tune prompts and retest.

---

## Path to First Dollar

### Fastest Path
Maker rebates on BTC 5-min markets. No prediction needed. Place orders both sides. Collect daily USDC.

### Timeline
- **Week 1:** Feed running on Mac, 30 paper signals validated ← YOU ARE HERE
- **Week 2:** Fund Kalshi $200, get API key
- **Week 3:** Place first MAKER order
- **Week 4:** First USDC rebate earned
- **Month 2:** Scale to $500-1K deployed
- **Month 3:** Bot running autonomously

---

## Configurable Settings (per user)
- Domain expertise: injected into swarm prompt via `userDomain` param
- Market categories: user selects which to track
- Strategy toggle: enable/disable each strategy independently
- Confidence threshold: adjustable (default 67%, min 50%)
- Kill switch threshold: adjustable (default -20% in 24h)
