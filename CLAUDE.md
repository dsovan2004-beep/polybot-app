# PolyBot — Cowork Project Context

## GitHub Access
GitHub repo: dsovan2004-beep/polybot-app
GitHub token: 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

## Working Folder
~/Desktop/PolyBot/

## Push to GitHub
Use GitHub Contents API with token above.
PUT https://api.github.com/repos/dsovan2004-beep/polybot-app/contents/{path}

## Project
PolyBot — AI-powered Polymarket trading bot
Stack: Next.js 15, Cloudflare Workers, Supabase, Claude API, OpenRouter
Strategies: Maker Bot, AI News Lag, Logical Arbitrage

## Rules
- Write files to ~/Desktop/PolyBot/ first
- Push to GitHub via API using token above
- Paper trade mode first
- WebSocket only no REST
- 2 categories max AI/Tech and Politics
- 67% confidence minimum
- Kill switch at -20% in 24hrs

## Sprint Status
- Sprint 1: COMPLETE ✅
- Sprint 2: COMPLETE ✅
- Sprint 3: COMPLETE ✅
- Sprint 4: COMPLETE ✅
- Sprint 5: IN PROGRESS 🔄 — First real money
- Site live at: polybot-app.pages.dev

## Architecture (IMPORTANT)
Cloudflare Workers are STATELESS — cannot hold persistent WebSocket connections.
Feed script (feed.ts) must run on Railway or another persistent server — NOT on Cloudflare Workers.
Data flow: Railway feed.ts → Supabase → Dashboard
