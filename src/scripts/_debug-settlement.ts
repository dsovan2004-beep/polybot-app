#!/usr/bin/env npx ts-node
// Debug: show ALL Kalshi settled positions and their matching Supabase trades
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const KALSHI_HOST = "https://api.elections.kalshi.com";
const KALSHI_API_PREFIX = "/trade-api/v2";
const KALSHI_API_KEY = process.env.KALSHI_API_KEY!;
const rawKey = process.env.KALSHI_PRIVATE_KEY || "";
const KALSHI_PRIVATE_KEY = rawKey.replace(/\\n/g, "\n");

function signRequest(pem: string, ts: string, method: string, fullPath: string): string {
  const pathOnly = fullPath.split("?")[0];
  const message = `${ts}${method}${pathOnly}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(message);
  sign.end();
  return sign.sign({ key: pem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, "base64");
}

async function kalshiFetch<T>(method: string, apiPath: string): Promise<T> {
  const fullPath = `${KALSHI_API_PREFIX}${apiPath}`;
  const ts = String(Date.now());
  const sig = signRequest(KALSHI_PRIVATE_KEY, ts, method, fullPath);
  const res = await fetch(`${KALSHI_HOST}${fullPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "KALSHI-ACCESS-KEY": KALSHI_API_KEY,
      "KALSHI-ACCESS-SIGNATURE": sig,
      "KALSHI-ACCESS-TIMESTAMP": ts,
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  console.log("\n=== KALSHI SETTLED POSITIONS (raw) ===\n");

  const data = await kalshiFetch<{
    market_positions: {
      ticker: string;
      realized_pnl_dollars: string;
      total_traded_dollars: string;
      position_fp: string;
    }[];
  }>("GET", "/portfolio/positions?settlement_status=settled&limit=100");

  const settled = data.market_positions ?? [];
  console.log(`Total settled positions: ${settled.length}\n`);

  // Show ALL non-zero settled positions
  const nonZero = settled.filter(p => {
    const t = parseFloat(String(p.total_traded_dollars ?? "0"));
    const pnl = parseFloat(String(p.realized_pnl_dollars ?? "0"));
    return t > 0 || pnl !== 0;
  });

  for (const p of nonZero) {
    console.log(`  ticker: ${p.ticker}`);
    console.log(`    realized_pnl_dollars: ${p.realized_pnl_dollars}`);
    console.log(`    total_traded_dollars: ${p.total_traded_dollars}`);
    console.log(`    position_fp: ${p.position_fp}`);
    console.log();
  }

  // Now check: does KXETHD-26APR1017-T2169.99 appear in settled?
  const ethMatch = settled.find(p => p.ticker === "KXETHD-26APR1017-T2169.99");
  console.log(`\n=== KXETHD-26APR1017-T2169.99 in settled? ${ethMatch ? "YES" : "NO"} ===`);
  if (ethMatch) {
    console.log(JSON.stringify(ethMatch, null, 2));
  }

  // Check for any KXETHD tickers in settled
  const ethSettled = settled.filter(p => p.ticker.startsWith("KXETHD"));
  console.log(`\n=== All KXETHD settled tickers (${ethSettled.length}) ===`);
  for (const p of ethSettled) {
    console.log(`  ${p.ticker} | pnl=${p.realized_pnl_dollars} | traded=${p.total_traded_dollars}`);
  }

  // Check Supabase: what trades have KXETHD in notes and outcome IS NULL?
  console.log("\n=== Supabase trades with KXETHD in notes, outcome IS NULL ===");
  const { data: openEth } = await sb
    .from("trades")
    .select("id, status, outcome, pnl, notes")
    .ilike("notes", "%KXETHD%")
    .is("outcome", null);
  console.log(JSON.stringify(openEth, null, 2));

  // Check Supabase: markets table entries for KXETHD tickers
  console.log("\n=== Supabase markets with polymarket_id containing KXETHD ===");
  const { data: ethMarkets } = await sb
    .from("markets")
    .select("id, polymarket_id, kalshi_ticker")
    .ilike("polymarket_id", "KXETHD-26APR1017%");
  console.log(JSON.stringify(ethMarkets, null, 2));

  // Check if market_id is shared
  if (ethMarkets && ethMarkets.length > 0) {
    for (const mkt of ethMarkets) {
      const { data: trades } = await sb
        .from("trades")
        .select("id, status, outcome, pnl, notes")
        .eq("market_id", mkt.id);
      console.log(`\n  Trades for market ${mkt.polymarket_id} (id=${mkt.id}):`);
      console.log(JSON.stringify(trades, null, 2));
    }
  }
}

main().catch((err) => { console.error("Crashed:", err); process.exit(1); });
