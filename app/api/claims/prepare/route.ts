import { db, json, requireCreatorSession } from "@/lib/server";

export async function POST(request: Request) {
  const session = await requireCreatorSession(request);
  if (!session) return json({ error: "Verify your creator profile first." }, { status: 401 });
  const route = await db().prepare("SELECT status FROM creator_routes WHERE id = ? LIMIT 1").bind(session.routeId).first<{ status: string }>();
  if (!route || route.status !== "verified") return json({ error: "Creator verification is required." }, { status: 403 });
  const batches = await db().prepare(
    `SELECT f.id, f.onchain_lot_id AS lotId, f.amount_raw AS amountRaw, f.asset_address AS asset,
      f.claim_deadline AS claimDeadline, l.id AS launchId, l.token_address AS tokenAddress,
      l.symbol AS tokenSymbol, l.vault_address AS vaultAddress
     FROM fee_batches f JOIN launch_links l ON l.id = f.launch_link_id
     WHERE f.route_id = ? AND f.status = 'claimable' AND f.claim_deadline > CURRENT_TIMESTAMP ORDER BY f.created_at`
  ).bind(session.routeId).all();
  const launchIds = [...new Set(batches.results.map((batch) => String(batch.launchId)))];
  const requests: Array<{ id: string; launchId: string }> = [];
  for (const launchId of launchIds) {
    const existing = await db().prepare(
      "SELECT id FROM claim_requests WHERE route_id = ? AND launch_link_id = ? AND status IN ('pending','submitted') LIMIT 1"
    ).bind(session.routeId, launchId).first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing) await db().prepare(
      "INSERT INTO claim_requests (id, route_id, launch_link_id) VALUES (?, ?, ?)"
    ).bind(id, session.routeId, launchId).run();
    requests.push({ id, launchId });
  }
  return json({
    routeId: session.routeId,
    batches: batches.results,
    requests,
    economics: { feeBps: 400, creatorBps: 8000, buybackBurnBps: 2000, claimWindowHours: 48 },
    destination: "ponspay-creator-vaults",
    ready: Boolean(requests.length && batches.results.every((batch) => batch.lotId && batch.vaultAddress)),
    next: requests.length ? "operator-processing" : "wait-for-fees",
  });
}
