import { db, getEnv, json, requireCreatorSession } from "@/lib/server";
import { createPublicClient, getAddress, http, parseAbi, zeroAddress } from "viem";

export async function GET(request: Request) {
  const session = await requireCreatorSession(request);
  if (!session) return json({ signedIn: false }, { status: 401 });
  const route = await db().prepare(
    `SELECT id AS routeId, platform, normalized_handle AS handle, display_name AS displayName,
      avatar_url AS avatarUrl, status FROM creator_routes WHERE id = ? LIMIT 1`
  ).bind(session.routeId).first();
  if (!route) return json({ signedIn: false }, { status: 404 });
  const vaultRows = await db().prepare(
    `SELECT l.id AS launchId, l.token_address AS tokenAddress, l.name AS tokenName, l.symbol AS tokenSymbol,
      l.vault_address AS vaultAddress,
      COALESCE(SUM(CASE WHEN f.status = 'claimable' AND f.claim_deadline > CURRENT_TIMESTAMP THEN CAST(f.amount_raw AS INTEGER) ELSE 0 END), 0) AS claimableRaw,
      COUNT(CASE WHEN f.status = 'claimable' AND f.claim_deadline > CURRENT_TIMESTAMP THEN 1 END) AS openBatches
     FROM launch_links l LEFT JOIN fee_batches f ON f.launch_link_id = l.id
     WHERE l.route_id = ? GROUP BY l.id ORDER BY l.created_at DESC`
  ).bind(session.routeId).all();
  const rpc = getEnv("ROBINHOOD_RPC_URL") ?? "https://rpc.mainnet.chain.robinhood.com";
  const client = createPublicClient({ transport: http(rpc, { timeout: 10_000, retryCount: 2 }) });
  const abi = parseAbi(["function creatorBalances(address asset) view returns(uint256)"]);
  const vaults = await Promise.all(vaultRows.results.map(async (row) => {
    const value = row as Record<string, unknown>;
    let nativeBalanceRaw = "0";
    if (typeof value.vaultAddress === "string") {
      try { nativeBalanceRaw = String(await client.readContract({ address: getAddress(value.vaultAddress), abi, functionName: "creatorBalances", args: [zeroAddress] })); }
      catch { /* vault may not be deployed yet */ }
    }
    return { ...value, nativeBalanceRaw };
  }));
  return json({ signedIn: true, route, vaults });
}
