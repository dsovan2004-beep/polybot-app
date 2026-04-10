#!/usr/bin/env npx ts-node
// One-time: restore KXETHD-26APR1017-T2169.99 to open (incorrectly marked as loss)
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const ticker = "KXETHD-26APR1017-T2169.99";
  console.log(`\n🔍 Finding trade for ${ticker}...\n`);

  const { data: before, error: findErr } = await sb
    .from("trades")
    .select("id, status, outcome, pnl, notes")
    .ilike("notes", `%${ticker}%`)
    .limit(5);

  if (findErr) { console.error("❌ Find failed:", findErr.message); process.exit(1); }
  if (!before || before.length === 0) { console.log("No matching trade found"); return; }

  console.log("BEFORE:", JSON.stringify(before, null, 2));

  const id = before[0].id;
  const { error: updateErr } = await sb
    .from("trades")
    .update({ outcome: null, pnl: null, status: "open" })
    .eq("id", id);

  if (updateErr) { console.error("❌ Update failed:", updateErr.message); process.exit(1); }

  const { data: after } = await sb
    .from("trades")
    .select("id, status, outcome, pnl, notes")
    .eq("id", id)
    .single();

  console.log("\nAFTER:", JSON.stringify(after, null, 2));
  console.log("\n✅ Trade restored to open\n");
}

main().catch((err) => { console.error("❌ Crashed:", err); process.exit(1); });
