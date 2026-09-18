import { db, getEnv, hmacHex, json, normalizeAddress, normalizeHash, stableId, timingSafeHexEqual } from "@/lib/server";

async function authenticate(request: Request, raw: string) {
  const secret = getEnv("OPERATOR_HMAC_SECRET") ?? getEnv("INGEST_HMAC_SECRET");
  if (!secret) return false;
  const provided = request.headers.get("x-pons-signature")?.replace(/^sha256=/, "") ?? "";
  return timingSafeHexEqual(provided, await hmacHex(secret, raw));
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!(await authenticate(request, raw))) return json({ error: "Invalid operator signature." }, { status: 401 });
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (body.action === "state") {
      const [intents, withdrawals, claimBatches, expiredBatches, buybacks] = await Promise.all([
        db().prepare(`SELECT i.id AS intentId, i.route_id AS routeId, i.launch_key AS launchKey, i.status,
          i.vault_address AS vaultAddress, l.id AS launchLinkId, l.token_address AS tokenAddress,
          r.vault_key AS creatorRouteKey, r.platform, r.normalized_handle AS handle
          FROM launch_intents i JOIN creator_routes r ON r.id = i.route_id
          LEFT JOIN launch_links l ON l.launch_intent_id = i.id
          WHERE i.status = 'launched' OR (i.status IN ('pending','vault_ready') AND DATETIME(i.expires_at) > CURRENT_TIMESTAMP)
          ORDER BY i.created_at`).all(),
        db().prepare(`SELECT w.id, w.route_id AS routeId, w.launch_link_id AS launchLinkId,
          l.vault_address AS vaultAddress, w.asset_address AS assetAddress, w.amount_raw AS amountRaw,
          w.recipient_address AS recipientAddress FROM withdrawal_requests w
          JOIN launch_links l ON l.id = w.launch_link_id WHERE w.status = 'pending' ORDER BY w.created_at LIMIT 50`).all(),
        db().prepare(`SELECT c.id AS requestId, c.route_id AS routeId, c.launch_link_id AS launchLinkId,
          l.vault_address AS vaultAddress, f.id AS batchId, f.onchain_lot_id AS lotId,
          f.asset_address AS assetAddress, f.amount_raw AS amountRaw
          FROM claim_requests c JOIN launch_links l ON l.id = c.launch_link_id
          JOIN fee_batches f ON f.launch_link_id = c.launch_link_id
          WHERE c.status = 'pending' AND f.status = 'claimable' AND f.claim_deadline > CURRENT_TIMESTAMP
          AND f.onchain_lot_id IS NOT NULL ORDER BY c.created_at, f.created_at LIMIT 200`).all(),
        db().prepare(`SELECT f.id AS batchId, f.onchain_lot_id AS lotId, f.asset_address AS assetAddress,
          f.amount_raw AS amountRaw, l.vault_address AS vaultAddress
          FROM fee_batches f JOIN launch_links l ON l.id = f.launch_link_id
          WHERE f.status = 'claimable' AND f.claim_deadline <= CURRENT_TIMESTAMP
          AND f.onchain_lot_id IS NOT NULL ORDER BY f.claim_deadline LIMIT 200`).all(),
        db().prepare(`SELECT id, source_type AS sourceType, source_id AS sourceId, amount_raw AS amountRaw
          FROM buyback_jobs WHERE status = 'pending' ORDER BY created_at LIMIT 50`).all(),
      ]);
      return json({ intents: intents.results, withdrawals: withdrawals.results, claimBatches: claimBatches.results, expiredBatches: expiredBatches.results, buybacks: buybacks.results });
    }
    if (body.action === "vault_provisioned") {
      const intentId = typeof body.intentId === "string" ? body.intentId : "";
      const vaultAddress = normalizeAddress(body.vaultAddress);
      const txHash = normalizeHash(body.txHash);
      if (!intentId || !vaultAddress || !txHash) return json({ error: "Invalid vault result." }, { status: 400 });
      await db().prepare("UPDATE launch_intents SET vault_address = ?, vault_tx_hash = ?, status = 'vault_ready' WHERE id = ? AND status = 'pending'").bind(vaultAddress, txHash, intentId).run();
      return json({ ok: true });
    }
    if (body.action === "launch_reconciled") {
      const intentId = typeof body.intentId === "string" ? body.intentId : "";
      const tokenAddress = normalizeAddress(body.tokenAddress);
      const vaultAddress = normalizeAddress(body.vaultAddress);
      const launcherAddress = normalizeAddress(body.launcherAddress);
      const launchTxHash = normalizeHash(body.launchTxHash);
      if (!intentId || !tokenAddress || !vaultAddress || !launcherAddress || !launchTxHash) return json({ error: "Invalid reconciled launch." }, { status: 400 });
      const intent = await db().prepare(
        `SELECT route_id AS routeId, chain_id AS chainId, launch_key AS launchKey,
          vault_address AS vaultAddress, vault_tx_hash AS vaultTxHash, status
         FROM launch_intents WHERE id = ? LIMIT 1`
      ).bind(intentId).first<{ routeId: string; chainId: number; launchKey: string; vaultAddress: string | null; vaultTxHash: string | null; status: string }>();
      if (!intent || intent.vaultAddress?.toLowerCase() !== vaultAddress) return json({ error: "The reconciled launch does not match its vault." }, { status: 409 });
      const launchId = await stableId("launch", `${intent.chainId}:${tokenAddress}`);
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 64) : null;
      const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase().slice(0, 16) : null;
      const logoUrl = typeof body.logoUrl === "string" ? body.logoUrl.trim().slice(0, 500) : null;
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : null;
      await db().prepare(
        `INSERT INTO launch_links (id, chain_id, token_address, route_id, launch_intent_id, vault_key, vault_address, vault_tx_hash, name, symbol, logo_url, description, launcher_address, creator_fee_bps, creator_share_bps, burn_share_bps, launch_tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 400, 8000, 2000, ?)
         ON CONFLICT(chain_id, token_address) DO NOTHING`
      ).bind(launchId, intent.chainId, tokenAddress, intent.routeId, intentId, intent.launchKey, vaultAddress, intent.vaultTxHash, name, symbol, logoUrl, description, launcherAddress, launchTxHash).run();
      await db().prepare("UPDATE launch_intents SET status = 'launched', finalized_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'vault_ready'").bind(intentId).run();
      return json({ ok: true, launchId });
    }
    if (body.action === "withdrawal_confirmed") {
      const id = typeof body.id === "string" ? body.id : "";
      const txHash = normalizeHash(body.txHash);
      if (!id || !txHash) return json({ error: "Invalid withdrawal result." }, { status: 400 });
      await db().prepare("UPDATE withdrawal_requests SET status = 'confirmed', tx_hash = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending','submitted')").bind(txHash, id).run();
      return json({ ok: true });
    }
    if (body.action === "withdrawal_submitted") {
      const id = typeof body.id === "string" ? body.id : "";
      const txHash = normalizeHash(body.txHash);
      if (!id || !txHash) return json({ error: "Invalid withdrawal submission." }, { status: 400 });
      await db().prepare("UPDATE withdrawal_requests SET status = 'submitted', tx_hash = ? WHERE id = ? AND status = 'pending'").bind(txHash, id).run();
      return json({ ok: true });
    }
    if (body.action === "claim_submitted") {
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      const txHash = normalizeHash(body.txHash);
      if (!requestId || !txHash) return json({ error: "Invalid claim submission." }, { status: 400 });
      await db().prepare("UPDATE claim_requests SET status = 'submitted', tx_hash = ? WHERE id = ? AND status = 'pending'").bind(txHash, requestId).run();
      return json({ ok: true });
    }
    if (body.action === "claim_confirmed") {
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      const txHash = normalizeHash(body.txHash);
      const batchIds = Array.isArray(body.batchIds) ? body.batchIds.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
      if (!requestId || !txHash || !batchIds.length) return json({ error: "Invalid claim result." }, { status: 400 });
      await db().prepare("UPDATE claim_requests SET status = 'confirmed', tx_hash = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending','submitted')").bind(txHash, requestId).run();
      for (const batchId of batchIds) await db().prepare("UPDATE fee_batches SET status = 'claimed', payout_tx_hash = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'claimable'").bind(txHash, batchId).run();
      const buybackAmountRaw = typeof body.buybackAmountRaw === "string" && /^[1-9][0-9]*$/.test(body.buybackAmountRaw) ? body.buybackAmountRaw : null;
      if (buybackAmountRaw) await db().prepare("INSERT INTO buyback_jobs (id, source_type, source_id, amount_raw) VALUES (?, 'creator_launch', ?, ?) ON CONFLICT(source_type, source_id) DO NOTHING").bind(crypto.randomUUID(), requestId, buybackAmountRaw).run();
      return json({ ok: true });
    }
    if (body.action === "official_fees_collected") {
      const txHash = normalizeHash(body.txHash);
      const amountRaw = typeof body.buybackAmountRaw === "string" && /^[1-9][0-9]*$/.test(body.buybackAmountRaw) ? body.buybackAmountRaw : null;
      if (!txHash || !amountRaw) return json({ error: "Invalid official fee collection." }, { status: 400 });
      await db().prepare("INSERT INTO buyback_jobs (id, source_type, source_id, amount_raw) VALUES (?, 'official_fees', ?, ?) ON CONFLICT(source_type, source_id) DO NOTHING").bind(crypto.randomUUID(), txHash, amountRaw).run();
      return json({ ok: true });
    }
    if (body.action === "buyback_submitted" || body.action === "buyback_confirmed") {
      const id = typeof body.id === "string" ? body.id : "";
      const txHash = normalizeHash(body.txHash);
      if (!id || !txHash) return json({ error: "Invalid buyback result." }, { status: 400 });
      const confirmed = body.action === "buyback_confirmed";
      await db().prepare(`UPDATE buyback_jobs SET status = ?, tx_hash = ?, settled_at = ${confirmed ? "CURRENT_TIMESTAMP" : "settled_at"} WHERE id = ? AND status IN ('pending','submitted')`).bind(confirmed ? "confirmed" : "submitted", txHash, id).run();
      return json({ ok: true });
    }
    if (body.action === "claim_failed") {
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      const message = typeof body.error === "string" ? body.error.slice(0, 500) : "Claim execution failed";
      if (!requestId) return json({ error: "Invalid claim failure." }, { status: 400 });
      await db().prepare("UPDATE claim_requests SET status = 'failed', error = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending','submitted')").bind(message, requestId).run();
      return json({ ok: true });
    }
    if (body.action === "expiry_confirmed") {
      const txHash = normalizeHash(body.txHash);
      const batchIds = Array.isArray(body.batchIds) ? body.batchIds.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
      if (!txHash || !batchIds.length) return json({ error: "Invalid expiry result." }, { status: 400 });
      for (const batchId of batchIds) await db().prepare("UPDATE fee_batches SET status = 'expired', burn_tx_hash = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'claimable'").bind(txHash, batchId).run();
      return json({ ok: true });
    }
    return json({ error: "Unknown operator action." }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: "operator_sync_failed", error: String(error) }));
    return json({ error: "Operator synchronization failed." }, { status: 400 });
  }
}
