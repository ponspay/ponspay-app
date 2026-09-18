import { db, publicJson } from "@/lib/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 64);
  const rows = await db().prepare(
    `SELECT l.id, l.chain_id AS chainId, l.token_address AS tokenAddress, l.name, l.symbol,
      l.logo_url AS logoUrl, l.description, l.launcher_address AS launcherAddress,
      l.vault_address AS vaultAddress, l.vault_tx_hash AS vaultTxHash, l.status,
      l.created_at AS createdAt, r.platform, r.normalized_handle AS creatorHandle,
      r.display_name AS creatorName, r.avatar_url AS creatorAvatar, r.status AS creatorStatus
     FROM launch_links l JOIN creator_routes r ON r.id = l.route_id
     WHERE (? = '' OR LOWER(COALESCE(l.name, '')) LIKE '%' || ? || '%'
       OR LOWER(COALESCE(l.symbol, '')) LIKE '%' || ? || '%'
       OR LOWER(l.token_address) LIKE '%' || ? || '%'
       OR LOWER(r.normalized_handle) LIKE '%' || ? || '%')
     ORDER BY l.created_at DESC LIMIT 60`
  ).bind(query, query, query, query, query).all();
  return publicJson({ launches: rows.results }, 5, 15);
}
