// ============================================================================
// POST /api/swarm — DISABLED (Sprint 7)
// Claude analysis now happens ONLY in feed.ts (Mac script).
// This route was calling Claude on every dashboard refresh = double cost.
// Returns empty response immediately — no Claude API calls.
// ============================================================================

export const runtime = "edge";

export async function POST() {
  return Response.json({
    ok: true,
    data: null,
    disabled: true,
    reason: "Claude analysis moved to feed.ts — swarm route disabled to save cost",
    timestamp: new Date().toISOString(),
  });
}
