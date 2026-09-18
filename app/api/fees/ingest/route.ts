import { db, getEnv, hmacHex, json, normalizeAddress, normalizeHash, stableId, timingSafeHexEqual } from "@/lib/server";

export async function POST(request: Request) {
  const secret = getEnv("INGEST_HMAC_SECRET");
  if (!secret) return json({ error: "Indexer authentication is not configured." }, { status: 503 });
  const raw = await request.text();
  const provided = request.headers.get("x-pons-signature")?.replace(/^sha256=/, "") ?? "";
  const expected = await hmacHex(secret, raw);
  if (!timingSafeHexEqual(provided, expected)) return json({ error: "Invalid indexer signature." }, { status: 401 });
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const chainId = Number(body.chainId);
    const token = normalizeAddress(body.tokenAddress);
    const routeId = typeof body.routeId === "string" && /^route_[A-Za-z0-9_-]{16,64}$/.test(body.routeId) ? body.routeId : null;
    const txHash = normalizeHash(body.txHash);
    const asset = body.assetAddress === "native" ? "native" : normalizeAddress(body.assetAddress);
    const logIndex = Number(body.logIndex);
    const amountRaw = typeof body.amountRaw === "string" && /^[1-9][0-9]*$/.test(body.amountRaw) ? body.amountRaw : null;
    const onchainLotId = typeof body.onchainLotId === "string" && /^[1-9][0-9]*$/.test(body.onchainLotId) ? body.onchainLotId : null;
    if (!Number.isInteger(chainId) || (!token && !routeId) || !txHash || !asset || !Number.isInteger(logIndex) || logIndex < 0 || !amountRaw || !onchainLotId) return json({ error: "Invalid fee event." }, { status: 400 });
    const requestedLaunchLinkId = typeof body.launchLinkId === "string" ? body.launchLinkId : null;
    const launch = token
      ? await db().prepare("SELECT id, route_id AS routeId FROM launch_links WHERE chain_id = ? AND token_address = ?").bind(chainId, token).first<{ id: string; routeId: string }>()
      : requestedLaunchLinkId
        ? await db().prepare("SELECT id, route_id AS routeId FROM launch_links WHERE id = ?").bind(requestedLaunchLinkId).first<{ id: string; routeId: string }>()
        : null;
    const resolvedRouteId = launch?.routeId ?? routeId;
    if (!resolvedRouteId || !launch) return json({ error: "Launch-specific creator route is not registered." }, { status: 404 });
    const route = await db().prepare("SELECT id FROM creator_routes WHERE id = ?").bind(resolvedRouteId).first();
    if (!route) return json({ error: "Creator route is not registered." }, { status: 404 });
    const batchId = await stableId("fee", `${chainId}:${txHash}:${logIndex}`);
    const claimDeadlineUnix = Number(body.claimDeadlineUnix);
    const deadline = Number.isInteger(claimDeadlineUnix) && claimDeadlineUnix > Math.floor(Date.now() / 1000) - 48 * 3600
      ? new Date(claimDeadlineUnix * 1000).toISOString()
      : new Date(Date.now() + 48 * 3600_000).toISOString();
    await db().prepare(
      "INSERT INTO fee_batches (id, route_id, launch_link_id, chain_id, tx_hash, log_index, asset_address, amount_raw, onchain_lot_id, claim_deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chain_id, tx_hash, log_index) DO NOTHING"
    ).bind(batchId, resolvedRouteId, launch?.id ?? null, chainId, txHash, logIndex, asset, amountRaw, onchainLotId, deadline).run();
    return json({ ok: true, batchId, claimDeadline: deadline }, { status: 202 });
  } catch (error) {
    console.error(JSON.stringify({ event: "fee_ingest_failed", error: String(error) }));
    return json({ error: "Fee event could not be recorded." }, { status: 400 });
  }
}
