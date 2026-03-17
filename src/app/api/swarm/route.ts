// ============================================================================
// POST /api/swarm — Run AI swarm analysis on a market
// Multi-model consensus: Claude + OpenRouter models vote, then aggregate
// Rule: 67% minimum confidence to produce a trade signal
// ============================================================================

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import type {
  ApiResponse,
  Market,
  SwarmVote,
  SwarmResult,
  ConsensusResult,
  Side,
  AIProvider,
} from "@/lib/types";
import { insertSwarmVote, insertSwarmResult } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MIN_CONFIDENCE = 0.67;
const MIN_AGREEMENT = 0.6; // 60% of models must agree

interface SwarmModel {
  provider: AIProvider;
  modelId: string;
  endpoint: string;
  apiKeyEnv: string;
}

const SWARM_MODELS: SwarmModel[] = [
  {
    provider: "claude",
    modelId: "claude-sonnet-4-20250514",
    endpoint: "https://api.anthropic.com/v1/messages",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-4o",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  {
    provider: "openrouter",
    modelId: "google/gemini-2.0-flash-001",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
];

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(market: Market): string {
  return `You are a prediction market analyst. Analyze this market and predict the outcome.

Market: ${market.question}
Description: ${market.description}
Category: ${market.category}
Current YES price: ${market.outcomePrices[0]} (implied ${(market.outcomePrices[0] * 100).toFixed(1)}%)
Current NO price: ${market.outcomePrices[1]} (implied ${(market.outcomePrices[1] * 100).toFixed(1)}%)
Volume: $${market.volume.toLocaleString()}
Liquidity: $${market.liquidity.toLocaleString()}
End date: ${market.endDate}

Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{
  "side": "yes" or "no",
  "confidence": 0.0 to 1.0,
  "reasoning": "your analysis",
  "keyFactors": ["factor1", "factor2", "factor3"]
}`;
}

// ---------------------------------------------------------------------------
// Model callers
// ---------------------------------------------------------------------------

async function callClaude(
  model: SwarmModel,
  prompt: string
): Promise<{ side: Side; confidence: number; reasoning: string; keyFactors: string[] }> {
  const apiKey = process.env[model.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing env: ${model.apiKeyEnv}`);

  const res = await fetch(model.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model.modelId,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text ?? "";
  return JSON.parse(content);
}

async function callOpenRouter(
  model: SwarmModel,
  prompt: string
): Promise<{ side: Side; confidence: number; reasoning: string; keyFactors: string[] }> {
  const apiKey = process.env[model.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing env: ${model.apiKeyEnv}`);

  const res = await fetch(model.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://polybot.app",
      "X-Title": "PolyBot Swarm",
    },
    body: JSON.stringify({
      model: model.modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return JSON.parse(content);
}

async function callModel(
  model: SwarmModel,
  prompt: string
): Promise<{ side: Side; confidence: number; reasoning: string; keyFactors: string[] }> {
  if (model.provider === "claude") return callClaude(model, prompt);
  return callOpenRouter(model, prompt);
}

// ---------------------------------------------------------------------------
// Consensus engine
// ---------------------------------------------------------------------------

function computeConsensus(
  votes: SwarmVote[],
  marketId: string
): { swarmResult: Omit<SwarmResult, "id" | "createdAt">; consensus: ConsensusResult } {
  const yesVotes = votes.filter((v) => v.predictedSide === "yes");
  const noVotes = votes.filter((v) => v.predictedSide === "no");

  const avgConfidence =
    votes.reduce((s, v) => s + v.confidence, 0) / votes.length;
  const maxConfidence = Math.max(...votes.map((v) => v.confidence));
  const minConfidence = Math.min(...votes.map((v) => v.confidence));

  const majorSide: Side = yesVotes.length >= noVotes.length ? "yes" : "no";
  const majorCount = Math.max(yesVotes.length, noVotes.length);
  const agreement = majorCount / votes.length;

  const majorVotes = votes.filter((v) => v.predictedSide === majorSide);
  const consensusConfidence =
    majorVotes.reduce((s, v) => s + v.confidence, 0) / majorVotes.length;

  const dissent = votes
    .filter((v) => v.predictedSide !== majorSide)
    .map((v) => `[${v.modelId}] ${v.reasoning}`);

  const consensusReached =
    agreement >= MIN_AGREEMENT && consensusConfidence >= MIN_CONFIDENCE;

  const swarmResult: Omit<SwarmResult, "id" | "createdAt"> = {
    marketId,
    votes,
    totalModels: votes.length,
    yesVotes: yesVotes.length,
    noVotes: noVotes.length,
    avgConfidence,
    maxConfidence,
    minConfidence,
    consensusReached,
    consensusSide: consensusReached ? majorSide : null,
    consensusConfidence: consensusReached ? consensusConfidence : null,
    dissent,
  };

  const consensus: ConsensusResult = {
    marketId,
    side: majorSide,
    confidence: consensusConfidence,
    agreement,
    reasoning: majorVotes.map((v) => v.reasoning).join(" | "),
    shouldTrade: consensusReached,
    swarmResultId: "", // filled after insert
    evaluatedAt: new Date().toISOString(),
  };

  return { swarmResult, consensus };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const { market } = (await req.json()) as { market: Market };

    if (!market?.id || !market?.question) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: "Missing or invalid market data",
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Validate category
    const allowedCategories = ["ai_tech", "politics"];
    if (!allowedCategories.includes(market.category)) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: `Market category "${market.category}" not in allowed list`,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const prompt = buildAnalysisPrompt(market);
    const swarmSessionId = crypto.randomUUID();

    // Call all models in parallel
    const votePromises = SWARM_MODELS.map(async (model) => {
      const start = Date.now();
      try {
        const result = await callModel(model, prompt);
        const vote: Omit<SwarmVote, "id"> = {
          swarmSessionId,
          marketId: market.id,
          provider: model.provider,
          modelId: model.modelId,
          predictedSide: result.side,
          confidence: Math.max(0, Math.min(1, result.confidence)),
          reasoning: result.reasoning,
          keyFactors: result.keyFactors,
          latencyMs: Date.now() - start,
          votedAt: new Date().toISOString(),
        };
        const saved = await insertSwarmVote(vote);
        return saved;
      } catch (err) {
        console.error(`Swarm vote failed for ${model.modelId}:`, err);
        return null;
      }
    });

    const results = await Promise.allSettled(votePromises);
    const votes = results
      .filter(
        (r): r is PromiseFulfilledResult<SwarmVote | null> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value)
      .filter((v): v is SwarmVote => v !== null);

    if (votes.length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: "All AI models failed — no votes collected",
          timestamp: new Date().toISOString(),
        },
        { status: 502 }
      );
    }

    // Compute consensus
    const { swarmResult, consensus } = computeConsensus(votes, market.id);
    const savedResult = await insertSwarmResult(swarmResult);
    consensus.swarmResultId = savedResult.id;

    return NextResponse.json<
      ApiResponse<{ swarmResult: SwarmResult; consensus: ConsensusResult }>
    >({
      ok: true,
      data: { swarmResult: savedResult, consensus },
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
