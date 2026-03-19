// ============================================================================
// POST /api/swarm — Claude-only AI Swarm (3 perspectives)
// 3 parallel Claude calls with different analyst personas
// Requires 2/3 agreement + 67% confidence minimum
// Outputs: YES / NO / NO_TRADE
// Accepts optional userDomain to inject domain expertise into prompts
// ============================================================================

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MIN_CONFIDENCE = 0.67;
const MIN_AGREEMENT = 2; // 2 out of 3 must agree

type SwarmSide = "YES" | "NO" | "NO_TRADE";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

interface SwarmVoteResult {
  role: string;
  side: SwarmSide;
  confidence: number;
  reasoning: string;
  keyFactors: string[];
  latencyMs: number;
}

interface SwarmResponse {
  votes: SwarmVoteResult[];
  consensus: SwarmSide;
  consensusConfidence: number;
  agreement: number;
  shouldTrade: boolean;
  dissent: string[];
  marketId: string;
  userDomain: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Market input shape
// ---------------------------------------------------------------------------

interface MarketInput {
  id: string;
  title: string;
  category: string;
  currentPrice: number;
  volume24h?: number;
  liquidity?: number;
  closesAt?: string;
}

// ---------------------------------------------------------------------------
// System prompts — 3 analyst perspectives
// userDomain is injected dynamically when provided
// ---------------------------------------------------------------------------

function buildAnalystPrompts(userDomain?: string | null) {
  const domainLine = userDomain
    ? `\nYou have deep domain expertise in: ${userDomain}. Use this knowledge to inform your analysis — look for patterns and signals that a generalist would miss.`
    : "";

  return [
    {
      role: "Probability Analyst",
      system: `You are a Probability Analyst for a prediction market trading bot.
Your job is to estimate the TRUE probability of an event occurring based on:
- Historical base rates for similar events
- Statistical patterns and data
- Reference class forecasting
- Calibration against known outcomes

You are data-driven and skeptical of narratives. You focus on numbers, not stories.
Do NOT be swayed by recent news hype — stick to what the data says.${domainLine}`,
    },
    {
      role: "News Analyst",
      system: `You are a News & Sentiment Analyst for a prediction market trading bot.
Your job is to assess how recent news and public sentiment affect the probability of an event:
- Breaking news and developments in the last 24-72 hours
- Social media sentiment and narrative shifts
- Expert opinions and insider signals
- Information that the market may not have priced in yet

You look for information edges — news the market is slow to react to.
Focus on what has CHANGED recently, not historical base rates.${domainLine}`,
    },
    {
      role: "Risk Analyst",
      system: `You are a Risk & Contrarian Analyst for a prediction market trading bot.
Your job is to identify reasons the consensus might be WRONG:
- Downside risks and tail events
- Hidden assumptions in the market price
- Scenarios where the obvious answer fails
- Liquidity traps and market manipulation signals
- Reasons to say NO_TRADE even if others are confident

You are the devil's advocate. If something seems too obvious, explain why it might not be.
You should have a higher bar for confidence than the other analysts.${domainLine}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Build the user prompt (same for all 3 analysts)
// ---------------------------------------------------------------------------

function buildUserPrompt(market: MarketInput): string {
  const impliedProb = (market.currentPrice * 100).toFixed(1);
  return `Analyze this prediction market and give your verdict.

Market: ${market.title}
Category: ${market.category}
Current YES price: ${market.currentPrice} (implied probability: ${impliedProb}%)
${market.volume24h ? `24h Volume: $${market.volume24h.toLocaleString()}` : ""}
${market.liquidity ? `Liquidity: $${market.liquidity.toLocaleString()}` : ""}
${market.closesAt ? `Closes: ${market.closesAt}` : ""}

You must respond with ONLY valid JSON (no markdown, no extra text):
{
  "side": "YES" or "NO" or "NO_TRADE",
  "confidence": 0.0 to 1.0,
  "reasoning": "your analysis in 2-3 sentences",
  "keyFactors": ["factor1", "factor2", "factor3"]
}

Rules:
- "YES" means you think the event WILL happen (price should be higher)
- "NO" means you think the event will NOT happen (price should be lower)
- "NO_TRADE" means you don't have enough edge to recommend a trade
- confidence must reflect how sure you are (0.67+ needed to trade)
- If the market price already reflects reality, say NO_TRADE`;
}

// ---------------------------------------------------------------------------
// Call Claude API
// ---------------------------------------------------------------------------

async function callClaude(
  systemPrompt: string,
  userPrompt: string
): Promise<{ side: SwarmSide; confidence: number; reasoning: string; keyFactors: string[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text ?? "";

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in Claude response");

  const parsed = JSON.parse(jsonMatch[0]);

  const side = String(parsed.side).toUpperCase() as SwarmSide;
  if (!["YES", "NO", "NO_TRADE"].includes(side)) {
    throw new Error(`Invalid side: ${parsed.side}`);
  }

  return {
    side,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence))),
    reasoning: String(parsed.reasoning ?? ""),
    keyFactors: Array.isArray(parsed.keyFactors)
      ? parsed.keyFactors.map(String)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Consensus engine — 2/3 agreement + 67% confidence
// ---------------------------------------------------------------------------

function computeConsensus(votes: SwarmVoteResult[]): {
  consensus: SwarmSide;
  consensusConfidence: number;
  agreement: number;
  shouldTrade: boolean;
  dissent: string[];
} {
  const counts: Record<SwarmSide, SwarmVoteResult[]> = {
    YES: [],
    NO: [],
    NO_TRADE: [],
  };
  for (const v of votes) {
    counts[v.side].push(v);
  }

  let majorSide: SwarmSide = "NO_TRADE";
  let majorCount = 0;
  for (const side of ["YES", "NO", "NO_TRADE"] as SwarmSide[]) {
    if (counts[side].length > majorCount) {
      majorCount = counts[side].length;
      majorSide = side;
    }
  }

  const majorVotes = counts[majorSide];
  const consensusConfidence =
    majorVotes.length > 0
      ? majorVotes.reduce((s, v) => s + v.confidence, 0) / majorVotes.length
      : 0;

  const dissent = votes
    .filter((v) => v.side !== majorSide)
    .map((v) => `[${v.role}] ${v.side} (${(v.confidence * 100).toFixed(0)}%) — ${v.reasoning}`);

  const shouldTrade =
    majorCount >= MIN_AGREEMENT &&
    consensusConfidence >= MIN_CONFIDENCE &&
    majorSide !== "NO_TRADE";

  return {
    consensus: majorSide,
    consensusConfidence,
    agreement: majorCount,
    shouldTrade,
    dissent,
  };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const market: MarketInput = body.market;
    const userDomain: string | null = body.userDomain ?? null;

    if (!market?.id || !market?.title) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: "Missing market.id or market.title",
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const userPrompt = buildUserPrompt(market);
    const analystPrompts = buildAnalystPrompts(userDomain);

    // Call Claude 3 times in parallel — one per analyst persona
    const votePromises = analystPrompts.map(async ({ role, system }) => {
      const start = Date.now();
      try {
        const result = await callClaude(system, userPrompt);
        return {
          role,
          side: result.side,
          confidence: result.confidence,
          reasoning: result.reasoning,
          keyFactors: result.keyFactors,
          latencyMs: Date.now() - start,
        } as SwarmVoteResult;
      } catch (err) {
        console.error(`Swarm vote failed for ${role}:`, err);
        return null;
      }
    });

    const results = await Promise.allSettled(votePromises);
    const votes = results
      .filter(
        (r): r is PromiseFulfilledResult<SwarmVoteResult | null> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value)
      .filter((v): v is SwarmVoteResult => v !== null);

    if (votes.length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: "All 3 Claude analyst calls failed — no votes collected",
          timestamp: new Date().toISOString(),
        },
        { status: 502 }
      );
    }

    const { consensus, consensusConfidence, agreement, shouldTrade, dissent } =
      computeConsensus(votes);

    const response: SwarmResponse = {
      votes,
      consensus,
      consensusConfidence,
      agreement,
      shouldTrade,
      dissent,
      marketId: market.id,
      userDomain,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json<ApiResponse<SwarmResponse>>({
      ok: true,
      data: response,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json<ApiResponse>(
      { ok: false, error: message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
