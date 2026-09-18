import { db, getEnv, json, normalizeAddress, normalizeHandle, normalizePlatform, sha256Hex, stableId } from "@/lib/server";
import { encodePacked, getAddress, keccak256 } from "viem";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const platform = normalizePlatform(body.platform);
    const handle = normalizeHandle(body.handle);
    const chainId = Number(body.chainId ?? 0);
    if (!platform || !handle) return json({ error: "Enter a valid Instagram or TikTok profile." }, { status: 400 });
    if (!Number.isInteger(chainId) || chainId <= 0) return json({ error: "Select a valid launch chain." }, { status: 400 });

    const routeId = await stableId("route", `${platform}:${handle}`);
    const creatorRouteKey = await sha256Hex(`pons:${platform}:${handle}`);
    await db().prepare(
      "INSERT INTO creator_routes (id, platform, normalized_handle, vault_key) VALUES (?, ?, ?, ?) ON CONFLICT(platform, normalized_handle) DO NOTHING"
    ).bind(routeId, platform, handle, creatorRouteKey).run();

    const tokenAddress = normalizeAddress(body.tokenAddress);
    if (!tokenAddress) {
      const launchSalt = typeof body.launchSalt === "string" && /^0x[a-fA-F0-9]{64}$/.test(body.launchSalt) ? body.launchSalt.toLowerCase() as `0x${string}` : null;
      const launcherAddress = normalizeAddress(body.launcherAddress);
      if (!launchSalt || !launcherAddress) return json({ error: "A launcher address and unique launch salt are required." }, { status: 400 });
      const launchKey = keccak256(encodePacked(["string", "bytes32", "address", "bytes32"], ["PONSPAY_LAUNCH", creatorRouteKey, getAddress(launcherAddress), launchSalt]));
      const intentId = await stableId("intent", `${routeId}:${chainId}:${launchKey}`);
      const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
      await db().prepare(
        `INSERT INTO launch_intents (id, route_id, chain_id, launch_key, expires_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(launch_key) DO NOTHING`
      ).bind(intentId, routeId, chainId, launchKey, expiresAt).run();
      const intent = await db().prepare(
        `SELECT id AS intentId, launch_key AS launchKey, vault_address AS vaultAddress,
          vault_tx_hash AS vaultTxHash, status, expires_at AS expiresAt
         FROM launch_intents WHERE id = ? LIMIT 1`
      ).bind(intentId).first();
      return json({ routeId, creatorRouteKey, platform, handle, feeBps: 400, launchSalt, vaultFactoryAddress: getEnv("VAULT_FACTORY_ADDRESS"), ...intent }, { status: 201 });
    }

    const intentId = typeof body.intentId === "string" ? body.intentId : "";
    if (!intentId) return json({ error: "The launch intent is required." }, { status: 400 });
    const intent = await db().prepare(
      `SELECT id, route_id AS routeId, chain_id AS chainId, launch_key AS launchKey,
        vault_address AS vaultAddress, vault_tx_hash AS vaultTxHash, status, expires_at AS expiresAt
       FROM launch_intents WHERE id = ? LIMIT 1`
    ).bind(intentId).first<{ id: string; routeId: string; chainId: number; launchKey: string; vaultAddress: string | null; vaultTxHash: string | null; status: string; expiresAt: string }>();
    if (!intent || intent.routeId !== routeId || intent.chainId !== chainId) return json({ error: "The launch intent does not match this creator route." }, { status: 409 });
    if (!intent.vaultAddress || intent.status !== "vault_ready") return json({ error: "The launch-specific vault is not ready." }, { status: 409 });
    if (new Date(intent.expiresAt).getTime() <= Date.now()) return json({ error: "The launch intent expired. Start the launch again." }, { status: 410 });

    const launchId = await stableId("launch", `${chainId}:${tokenAddress}`);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 64) : null;
    const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase().slice(0, 16) : null;
    const logoUrl = typeof body.logoUrl === "string" ? body.logoUrl.trim().slice(0, 500) : null;
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : null;
    const launcherAddress = normalizeAddress(body.launcherAddress);
    const launchTxHash = typeof body.launchTxHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(body.launchTxHash) ? body.launchTxHash.toLowerCase() : null;
    await db().prepare(
      `INSERT INTO launch_links (id, chain_id, token_address, route_id, launch_intent_id, vault_key, vault_address, vault_tx_hash, name, symbol, logo_url, description, launcher_address, creator_fee_bps, creator_share_bps, burn_share_bps, launch_tx_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 400, 8000, 2000, ?)
       ON CONFLICT(chain_id, token_address) DO NOTHING`
    ).bind(launchId, chainId, tokenAddress, routeId, intentId, intent.launchKey, intent.vaultAddress, intent.vaultTxHash, name, symbol, logoUrl, description, launcherAddress, launchTxHash).run();
    await db().prepare("UPDATE launch_intents SET status = 'launched', finalized_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'vault_ready'").bind(intentId).run();
    return json({ launchId, intentId, routeId, launchKey: intent.launchKey, vaultAddress: intent.vaultAddress, platform, handle, feeBps: 400 }, { status: 201 });
  } catch (error) {
    console.error(JSON.stringify({ event: "route_create_failed", error: String(error) }));
    return json({ error: "The launch route could not be created." }, { status: 500 });
  }
}
