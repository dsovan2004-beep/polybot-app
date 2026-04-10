// ============================================================================
// PolyBot — P&L Backfill v2 (self-contained)
// Queries ALL unresolved trades from Supabase, extracts tickers from notes
// (handles both AUTO-EXEC and SETTLED formats), queries Kalshi for market
// results, and writes correct outcome + net P&L.
//
// Usage: cd ~/Desktop/PolyBot && npx ts-node src/scripts/backfill-pnl.ts
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ── Supabase ──
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Kalshi ──
const KALSHI_HOST = "https://api.elections.kalshi.com";
const KALSHI_API_PREFIX = "/trade-api/v2";
const KALSHI_API_KEY = process.env.KALSHI_API_KEY!;
const rawKalshiKey = process.env.KALSHI_PRIVATE_KEY || "";
const KALSHI_PRIVATE_KEY = rawKalshiKey.replace(/\\n/g, "\n");

if (!KALSHI_API_KEY || !KALSHI_PRIVATE_KEY) {
  console.error("❌ Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY in .env.local");
  process.exit(1);
}

function signRequest(privateKeyPem: string, timestampMs: string, method: string, fullPath: string): string {
  const pathOnly = fullPath.split("?")[0];
  const message = `${timestampMs}${method}${pathOnly}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(message);
  sign.end();
  return sign.sign(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
    "base64"
  );
}

async function kalshiFetch<T>(method: string, apiPath: string): Promise<T> {
  const fullPath = `${KALSHI_API_PREFIX}${apiPath}`;
  const timestampMs = String(Date.now());
  const signature = signRequest(KALSHI_PRIVATE_KEY, timestampMs, method, fullPath);
  const url = `${KALSHI_HOST}${fullPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "KALSHI-ACCESS-KEY": KALSHI_API_KEY,
      "KALSHI-ACCESS-SIGNATURE": signature,
      "KALSHI-ACCESS-TIMESTAMP": timestampMs,
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Kalshi ${method} ${fullPath} → ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ── Extract ticker from notes (handles both formats) ──
function extractTicker(notes: string): string | null {
  if (!notes) return null;

  // Format 1: "AUTO-EXEC: {orderId} | {ticker} | conf:..."
  if (notes.startsWith("AUTO-EXEC:")) {
    const parts = notes.split("|").map((s) => s.trim());
    return parts.length >= 2 ? parts[1] : null;
  }

  // Format 2: "SETTLED: {ticker} | P&L: ..." or "SETTLED: {ticker} | result:..."
  if (notes.startsWith("SETTLED:")) {
    const afterSettled = notes.slice("SETTLED:".length).trim();
    const parts = afterSettled.split("|").map((s) => s.trim());
    return parts.length >= 1 ? parts[0] : null;
  }

  return null;
}

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  PolyBot — P&L Backfill v2 (Kalshi queries)");
  console.log("═══════════════════════════════════════════════\n");

  // Step 1: Fetch ALL unresolved trades
  const { data: trades, error: fetchErr } = await supabase
    .from("trades")
    .select("id, direction, notes, entry_price, shares, entry_cost")
    .is("outcome", null)
    .order("id", { ascending: true })
    .limit(500);

  if (fetchErr) {
    console.error(`❌ Failed to fetch trades: ${fetchErr.message}`);
    process.exit(1);
  }

  if (!trades || trades.length === 0) {
    console.log("✅ No unresolved trades found — nothing to backfill.");
    process.exit(0);
  }

  console.log(`📊 Found ${trades.length} unresolved trades to backfill\n`);

  let synced = 0;
  let stillOpen = 0;
  let apiErrors = 0;
  let noTicker = 0;

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    const ticker = extractTicker(trade.notes ?? "");

    if (!ticker) {
      noTicker++;
      console.log(`  ⚠️  [${i + 1}/${trades.length}] No ticker in notes: "${(trade.notes ?? "").slice(0, 60)}"`);
      continue;
    }

    // Query Kalshi for market result
    try {
      const marketData = await kalshiFetch<{
        market: { ticker: string; status: string; result: string };
      }>("GET", `/markets/${ticker}`);

      const market = marketData.market;
      if (!market || market.status !== "finalized") {
        stillOpen++;
        continue;
      }

      // Determine outcome
      const marketResult = market.result; // "yes" or "no"
      const tradeDir = (trade.direction ?? "").toLowerCase();
      const outcome: "win" | "loss" = marketResult === tradeDir ? "win" : "loss";

      // Calculate net P&L using stored entry_cost (correct for NO trades)
      const entryPrice = parseFloat(String(trade.entry_price ?? "0"));
      const shares = parseInt(String(trade.shares ?? "0"), 10);
      const entryCost = parseFloat(String(trade.entry_cost ?? "0")) || (entryPrice * shares);
      const pnl = outcome === "win"
        ? (1.0 * shares) - entryCost
        : -entryCost;

      const { error: updateErr } = await supabase
        .from("trades")
        .update({
          status: "closed",
          outcome,
          pnl: Math.round(pnl * 100) / 100,
          exit_at: new Date().toISOString(),
          notes: `SETTLED: ${ticker} | result:${marketResult} | ${outcome === "win" ? "+" : ""}$${pnl.toFixed(2)}`,
        })
        .eq("id", trade.id);

      if (!updateErr) {
        synced++;
        const emoji = outcome === "win" ? "✅" : "❌";
        console.log(`  ${emoji} [${i + 1}/${trades.length}] ${ticker} → ${outcome} (${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)})`);
      }

      // Rate limiting delay
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (err) {
      apiErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️  [${i + 1}/${trades.length}] API error for ${ticker}: ${msg.slice(0, 80)}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`✅ Backfill complete:`);
  console.log(`   ${synced} synced | ${stillOpen} still open | ${apiErrors} API errors | ${noTicker} no ticker`);
  console.log(`═══════════════════════════════════════════════`);
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
