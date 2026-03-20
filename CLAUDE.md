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

## Environment Variables
All keys are in ~/Desktop/PolyBot/.env.local
NEVER ask the user for keys — read from .env.local directly.
NEVER hardcode keys in any file. NEVER prompt user to paste keys in chat.
Use: dotenv.config({ path: '.env.local' }) then process.env.KEY_NAME
Keys available:
- ANTHROPIC_API_KEY
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

## Architecture (IMPORTANT)
Cloudflare Workers are STATELESS — cannot hold persistent WebSocket connections.
Feed script (feed.ts) runs on user's Mac (or future persistent server) — NOT on Cloudflare Workers.
Data flow: Mac feed.ts → Supabase → Dashboard
