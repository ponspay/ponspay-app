import { db, json, normalizeHandle, normalizePlatform } from "@/lib/server";

export async function GET(_request: Request, context: { params: Promise<{ platform: string; handle: string }> }) {
  const params = await context.params;
  const platform = normalizePlatform(params.platform);
  const handle = normalizeHandle(params.handle);
  if (!platform || !handle) return json({ error: "Route not found." }, { status: 404 });
  const route = await db().prepare(
    `SELECT r.id AS routeId, r.platform, r.normalized_handle AS handle, r.display_name AS displayName,
      r.avatar_url AS avatarUrl, r.status, r.vault_key AS vaultKey, r.vault_address AS vaultAddress,
      COUNT(DISTINCT l.id) AS launches,
      COALESCE(SUM(CASE WHEN f.status = 'claimable' THEN CAST(f.amount_raw AS INTEGER) ELSE 0 END), 0) AS claimableRaw
     FROM creator_routes r
     LEFT JOIN launch_links l ON l.route_id = r.id
     LEFT JOIN fee_batches f ON f.launch_link_id = l.id
     WHERE r.platform = ? AND r.normalized_handle = ? GROUP BY r.id LIMIT 1`
  ).bind(platform, handle).first();
  return route ? json(route) : json({ error: "No linked launches found yet." }, { status: 404 });
}
