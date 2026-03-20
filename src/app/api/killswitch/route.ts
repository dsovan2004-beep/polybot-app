// ============================================================================
// PolyBot — Kill Switch API (Sprint 6 Security Fix)
// POST /api/killswitch  → Activate kill switch
// GET  /api/killswitch  → Check kill switch status
// Edge runtime compatible
// ============================================================================

import { getSupabase } from "@/lib/supabase";

export const runtime = "edge";

// ---------------------------------------------------------------------------
// GET — check current kill switch status
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await getSupabase()
      .from("performance")
      .select("kill_switch")
      .eq("date", today)
      .single();

    if (error && error.code !== "PGRST116") {
      return Response.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const active = data?.kill_switch === true;
    return Response.json({ ok: true, data: { active } });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — activate kill switch (sets kill_switch=true for today)
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Upsert today's performance row with kill_switch = true
    const { error } = await getSupabase()
      .from("performance")
      .upsert(
        {
          date: today,
          kill_switch: true,
          trades_count: 0,
          wins: 0,
          losses: 0,
        },
        { onConflict: "date" }
      );

    if (error) {
      return Response.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return Response.json({ ok: true, data: { status: "killed" } });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
