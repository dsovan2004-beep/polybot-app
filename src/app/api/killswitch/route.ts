// ============================================================================
// PolyBot — Kill Switch API (Sprint 6 Security Fix)
// POST /api/killswitch  → Activate kill switch
// GET  /api/killswitch  → Check kill switch status
// Edge runtime compatible
// ============================================================================

import { getSupabase, getServiceSupabase } from "@/lib/supabase";

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
// POST — toggle kill switch on/off
// Body: { "active": true/false } or { "kill": true/false }
// No body = activate (backward compatible)
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Parse request body to determine desired state
    let activate = true; // default: activate kill switch (backward compatible)
    try {
      const body = await request.json();
      if (typeof body.active === "boolean") {
        activate = body.active;
      } else if (typeof body.kill === "boolean") {
        activate = body.kill;
      }
    } catch {
      // No body or invalid JSON — default to activate (backward compatible)
    }

    // Upsert today's performance row — only touch kill_switch, never zero trade stats
    const { error } = await getServiceSupabase()
      .from("performance")
      .upsert(
        {
          date: today,
          kill_switch: activate,
        },
        { onConflict: "date" }
      );

    if (error) {
      return Response.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const status = activate ? "killed" : "active";
    return Response.json({ ok: true, data: { active: activate, status } });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
