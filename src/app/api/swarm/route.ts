// ============================================================================
// POST /api/swarm — Claude AI Signal Generator (Sprint 4)
// Analyzes a Polymarket market using Claude Sonnet
// Saves signal to Supabase signals table
// Rules: 67% confidence min, 10% price gap min, otherwise NO_TRADE
// ============================================================================

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import type { SignalRow } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MIN_CONFIDENCE = 67;
const MIN_PRICE_GAP = 0.10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

interface MarketInput {
  id: string;
  polymarket_id: string;
  title: string;
  category: string;
  current_price: number;
  volume_24h?: number;
  liquidity?: number;
  closes_at?: string;
}

interface ClaudeSignal {
  vote: "YES" | "NO" | "NO_TRADE";
  probability: number;
  confidence: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// System prompt — domain expertise
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are analyzing a Polymarket prediction market as a specialist with 20+ years enterprise IT and security experience, 2 completed M&A integrations, deep expertise in Okta, CrowdStrike, Zscaler, 4x SOC 2 Type II audit lead, and active AI red team testing experience.

Analyze this market. Output ONLY valid JSON:
{
  "vote": "YES" or "NO" or "NO_TRADE",
  "probability": 0.00 to 1.00,
  "confidence": 0 to 100,
  "reason": "one sentence max"
}

Rules:
- Only vote YES or NO if your confidence is >= 67
- Only vote YES or NO if the price gap is >= 10% (abs(your probability - market price) > 0.10)
- Otherwise vote NO_TRADE
- Be calibrated — don't be overconfident
- Consider base rates, recent news, and market efficiency`;

// ---------------------------------------------------------------------------
// Build user prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(market: MarketInput): string {
  return `Market: ${market.title}
Category: ${market.category}
Current YES price: ${market.current_price} (implied probability: ${(market.current_price * 100).toFixed(1)}%)
${market.volume_24h ? `24h Volume: $${market.volume_24h.toLocaleString()}` : ""}
${market.liquidity ? `Liquidity: $${market.liquidity.toLocaleString()}` : ""}
${market.closes_at ? `Closes: ${market.closes_at}` : ""}

What is your analysis?`;
}

// ---------------------------------------------------------------------------
// Call Claude API
// ---------------------------------------------------------------------------

async function callClaude(userPrompt: string): Promise<ClaudeSignal> {
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
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text ?? "";

  // Parse JSON, handle markdown wrapping
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Claude response");

  const parsed = JSON.parse(jsonMatch[0]);

  const vote = String(parsed.vote).toUpperCase();
  if (!["YES", "NO", "NO_TRADE"].includes(vote)) {
    throw new Error(`Invalid vote: ${parsed.vote}`);
  }

  return {
    vote: vote as "YES" | "NO" | "NO_TRADE",
    probability: Math.max(0, Math.min(1, Number(parsed.probability))),
    confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence)))),
    reason: String(parsed.reason ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Save signal to Supabase
// ---------------------------------------------------------------------------

async function saveSignal(
  market: MarketInput,
  signal: ClaudeSignal
): Promise<SignalRow> {
  const priceGap = Math.abs(signal.probability - market.current_price);

  const row: Omit<SignalRow, "id" | "created_at"> = {
    market_id: market.id,
    strategy: "ai_swarm",
    claude_vote: signal.vote,
    gpt4o_vote: null,
    gemini_vote: null,
    consensus: signal.vote,
    confidence: signal.confidence,
    ai_probability: signal.probability,
    market_price: market.current_price,
    price_gap: priceGap,
    reasoning: signal.reason,
    acted_on: false,
  };

  const { data, error } = await getSupabase()
    .from("signals")
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`saveSignal: ${error.message}`);
  return data as SignalRow;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const market: MarketInput = body.market;

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

    // Call Claude
    const userPrompt = buildUserPrompt(market);
    const signal = await callClaude(userPrompt);

    // Apply rules: 67% confidence and 10% price gap
    const priceGap = Math.abs(signal.probability - market.current_price);

    if (signal.confidence < MIN_CONFIDENCE || priceGap < MIN_PRICE_GAP) {
      signal.vote = "NO_TRADE";
    }

    // Save to Supabase
    const saved = await saveSignal(market, signal);

    return NextResponse.json<ApiResponse<SignalRow>>({
      ok: true,
      data: saved,
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
