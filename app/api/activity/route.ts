import { db, publicJson } from "@/lib/server";

export async function GET() {
  try {
    const rows = await db().prepare(
      `SELECT * FROM (
        SELECT w.id, 'payment' AS eventType, w.amount_raw AS amountRaw,
          w.asset_address AS assetAddress, w.tx_hash AS txHash,
          COALESCE(w.settled_at, w.created_at) AS eventAt,
          r.normalized_handle AS creatorHandle, r.display_name AS creatorName,
          r.avatar_url AS creatorAvatar, r.platform,
          NULL AS tokenName, NULL AS tokenSymbol
        FROM withdrawal_requests w
        JOIN creator_routes r ON r.id = w.route_id
        WHERE w.status = 'confirmed' AND w.tx_hash IS NOT NULL
        UNION ALL
        SELECT f.id, 'fee_route' AS eventType, f.amount_raw AS amountRaw,
          f.asset_address AS assetAddress, f.tx_hash AS txHash,
          f.created_at AS eventAt,
          r.normalized_handle AS creatorHandle, r.display_name AS creatorName,
          r.avatar_url AS creatorAvatar, r.platform,
          l.name AS tokenName, l.symbol AS tokenSymbol
        FROM fee_batches f
        LEFT JOIN launch_links l ON l.id = f.launch_link_id
        JOIN creator_routes r ON r.id = f.route_id
      )
      ORDER BY eventAt DESC
      LIMIT 30`
    ).all();
    return publicJson({ activity: rows.results }, 5, 15);
  } catch {
    return publicJson({ activity: [] }, 5, 15);
  }
}
