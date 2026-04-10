// ============================================================================
// PolyBot — Reset today's trade outcomes (one-time fix)
// Clears outcome + pnl on Apr 7 trades so settlement sync re-processes them
// with the corrected formula (realized_pnl_dollars is already net P&L).
//
// Usage: cd ~/Desktop/PolyBot && npx ts-node src/scripts/reset-today.ts
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const today = "2026-04-07";
  const todayStart = `${today}T00:00:00.000Z`;
  const todayEnd = `${today}T23:59:59.999Z`;

  console.log(`\n=== Reset trades for ${today} ===\n`);

  // Step 1: Find today's trades that have outcome set
  const { data: trades, error: fetchErr } = await supabase
    .from("trades")
    .select("id, direction, outcome, pnl, notes, entry_at")
    .gte("entry_at", todayStart)
    .lte("entry_at", todayEnd)
    .not("outcome", "is", null);

  if (fetchErr) {
    console.error(`Failed to fetch trades: ${fetchErr.message}`);
    process.exit(1);
  }

  if (!trades || trades.length === 0) {
    console.log("No trades with outcome found for today — nothing to reset.");
    process.exit(0);
  }

  console.log(`Found ${trades.length} trades to reset:\n`);

  for (const t of trades) {
    const ticker = (t.notes ?? "").slice(0, 70);
    console.log(`  ${t.outcome === "win" ? "W" : "L"} | pnl: $${Number(t.pnl ?? 0).toFixed(2)} | ${t.direction} | ${ticker}`);
  }

  // Step 2: Reset outcome and pnl to null
  const ids = trades.map((t) => t.id);
  const { error: updateErr, count } = await supabase
    .from("trades")
    .update({ outcome: null, pnl: null, status: "open" })
    .in("id", ids);

  if (updateErr) {
    console.error(`Update failed: ${updateErr.message}`);
    process.exit(1);
  }

  console.log(`\n✅ Reset ${trades.length} trades (outcome → null, pnl → null, status → open)`);
  console.log("   Settlement sync will re-process them on next feed poll cycle.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
