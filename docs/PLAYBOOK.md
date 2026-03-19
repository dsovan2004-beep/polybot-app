# THE PLAYBOOK - Execution Framework

Strategy 1: Maker Bot - place limit orders both YES and NO earn spread plus USDC rebates daily
Strategy 2: AI News Lag - breaking news creates 30sec to 5min window before market reprices
Strategy 3: Logical Arbitrage - math errors across correlated markets zero risk guaranteed profit

AI Swarm: Claude-only — 3 parallel calls with different analyst personas
  Vote 1: Claude as Probability Analyst — historical base rates, statistical patterns, reference class forecasting
  Vote 2: Claude as News Analyst — breaking news, sentiment shifts, information edges the market hasn't priced in
  Vote 3: Claude as Risk Analyst — downside risks, contrarian view, reasons the consensus might be wrong

Consensus: 2 of 3 votes must agree AND confidence must be 67% or higher to signal
Outputs: YES / NO / NO_TRADE
Only requires ANTHROPIC_API_KEY — no OpenRouter, no GPT-4o, no Gemini
System prompt includes 20yr IT/MA/AI security domain expertise
