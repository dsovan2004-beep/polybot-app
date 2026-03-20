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
- Sprint 5: COMPLETE ✅ — 50 signals flowing, dashboard live
- Sprint 6: IN PROGRESS 🔄 — First real money
- Site live at: polybot-app.pages.dev

## Signal Stats (Sprint 5)
- 50 signals generated in first live session
- First signal with edge: Iranian regime NO at 85% confidence
- Signal History live on dashboard
- Full pipeline: Polymarket WS → feed.ts (Mac) → Claude → Supabase → Dashboard

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
Cloudflare Workers timeout at 8 seconds — NOT enough for Claude API calls.
Feed script (feed.ts) runs on user's Mac terminal — NOT on Cloudflare Workers.
Claude analysis runs INLINE in feed.ts — never in Cloudflare edge functions.
Data flow: Mac feed.ts → Supabase → Dashboard

## Technical Lessons (IMPORTANT)
- Always use SUPABASE_SERVICE_ROLE_KEY for writes (anon key = read only with RLS)
- Service role client needs: `auth: { autoRefreshToken: false, persistSession: false }`
- RLS policies must allow inserts on signals table
- Claude Haiku = 20x cheaper than Sonnet for signal generation
- Always run startup self-test before trading (verifies Supabase + Claude)
- 15-second timeout on Anthropic SDK prevents hanging calls
- Dedup markets with Set to avoid repeat Claude calls
