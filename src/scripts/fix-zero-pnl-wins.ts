#!/usr/bin/env npx ts-node
// ============================================================================
// One-time fix: Reclassify trades with outcome='win' and pnl=0 as 'loss'
// These were misclassified by the old formula (pnlNet >= 0 → "win")
// Usage: cd ~/Desktop/PolyBot && npx ts-node src/scripts/fix-zero-pnl-wins.ts
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

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
  console.log("\n🔍 Querying trades with outcome='win' AND pnl=0...\n");

  const { data: trades, error } = await supabase
    .from("trades")
    .select("id, notes, outcome, pnl, status")
    .eq("outcome", "win")
    .eq("pnl", 0)
    .eq("status", "closed");

  if (error) {
    console.error("❌ Query failed:", error.message);
    process.exit(1);
  }

  if (!trades || trades.length === 0) {
    console.log("✅ No trades found with outcome='win' and pnl=0. Nothing to fix.");
    return;
  }

  console.log(`Found ${trades.length} trade(s) to reclassify:\n`);
  for (const t of trades) {
    const note = (t.notes ?? "").slice(0, 80);
    console.log(`  - id=${t.id} | status=${t.status} | pnl=${t.pnl} | outcome=${t.outcome} | ${note}`);
  }

  // --- DRY RUN complete, now apply ---
  console.log(`\n🔧 Updating ${trades.length} trade(s) to outcome='loss'...\n`);

  let fixed = 0;
  for (const t of trades) {
    const { error: updateErr } = await supabase
      .from("trades")
      .update({ outcome: "loss" })
      .eq("id", t.id);

    if (updateErr) {
      console.error(`  ❌ Failed to update id=${t.id}: ${updateErr.message}`);
    } else {
      fixed++;
      console.log(`  ✅ Fixed id=${t.id} → outcome='loss'`);
    }
  }

  console.log(`\n🏁 Done. ${fixed}/${trades.length} trades reclassified as loss.\n`);
}

main().catch((err) => {
  console.error("❌ Script crashed:", err);
  process.exit(1);
});
