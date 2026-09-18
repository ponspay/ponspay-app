import { db, json, normalizeAddress, requireCreatorSession } from "@/lib/server";

export async function POST(request: Request) {
  const session = await requireCreatorSession(request);
  if (!session) return json({ error: "Verify your creator profile first." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const recipient = normalizeAddress(body.recipientAddress);
  const asset = body.assetAddress === "native" ? "native" : normalizeAddress(body.assetAddress);
  const amountRaw = typeof body.amountRaw === "string" && /^[1-9][0-9]*$/.test(body.amountRaw) ? body.amountRaw : null;
  const launchId = typeof body.launchId === "string" ? body.launchId : "";
  if (!recipient || !asset || !amountRaw || !launchId) return json({ error: "Enter a valid launch, destination, asset, and amount." }, { status: 400 });

  const route = await db().prepare(
    `SELECT r.status, l.vault_address AS vaultAddress FROM creator_routes r
     JOIN launch_links l ON l.route_id = r.id WHERE r.id = ? AND l.id = ? LIMIT 1`
  ).bind(session.routeId, launchId).first<{ vaultAddress: string | null; status: string }>();
  if (!route || route.status !== "verified") return json({ error: "Creator verification is required." }, { status: 403 });
  if (!route.vaultAddress) return json({ error: "The live vault factory has not been deployed yet." }, { status: 503 });

  const id = crypto.randomUUID();
  await db().prepare(
    "INSERT INTO withdrawal_requests (id, route_id, launch_link_id, asset_address, amount_raw, recipient_address) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, session.routeId, launchId, asset, amountRaw, recipient).run();
  return json({ id, vaultAddress: route.vaultAddress, recipientAddress: recipient, assetAddress: asset, amountRaw, status: "pending", next: "attestor-sign-and-relay" }, { status: 202 });
}
