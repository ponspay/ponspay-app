import { cacheProfileAvatar, db, normalizeHandle, randomToken, sha256, stableId } from "@/lib/server";
import { normalizePhylloAccount, phylloRequest, retrievePhylloIdentity } from "@/lib/phyllo";

type VerificationState = { platform: "instagram" | "tiktok"; phylloUserId: string; packedReturnTo: string };

export type CompletedCreatorVerification = {
  cookie: string;
  handle: string;
  platform: "instagram" | "tiktok";
  returnTo: string;
};

async function readState(stateToken: string) {
  const state = await db().prepare(
    `SELECT platform, code_verifier AS phylloUserId, return_to AS packedReturnTo
     FROM oauth_states WHERE state = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1`
  ).bind(stateToken).first<VerificationState>();
  if (!state) return null;
  const [returnTo = "/creator", requestedHandle = "", expectedWorkPlatformId = ""] = state.packedReturnTo.split("|");
  return { ...state, returnTo, requestedHandle, expectedWorkPlatformId };
}

export async function discoverConnectedPhylloAccount(stateToken: string): Promise<string | null | undefined> {
  const state = await readState(stateToken);
  if (!state) return undefined;
  const payload = await phylloRequest(`/v1/accounts?limit=100&user_id=${encodeURIComponent(state.phylloUserId)}`);
  const accounts = Array.isArray(payload.data) ? payload.data.map(normalizePhylloAccount) : [];
  const matching = accounts.filter((account) => account.userId === state.phylloUserId && account.workPlatformId === state.expectedWorkPlatformId);
  const connected = matching.find((account) => account.status.toUpperCase() === "CONNECTED")
    ?? matching.find((account) => !["DISCONNECTED", "FAILED"].includes(account.status.toUpperCase()));
  return connected?.id ?? null;
}

export async function completePhylloVerification(
  stateToken: string,
  accountId: string,
  event?: { userId: string; workPlatformId: string },
): Promise<CompletedCreatorVerification | null> {
  const state = await readState(stateToken);
  if (!state) return null;
  if (event && (event.userId !== state.phylloUserId || event.workPlatformId !== state.expectedWorkPlatformId)) {
    throw new Error("The verification callback did not match this secure session.");
  }
  const identity = await retrievePhylloIdentity(accountId, state.phylloUserId, state.expectedWorkPlatformId);
  if (!identity) return null;
  const handle = normalizeHandle(identity.username);
  if (!handle) throw new Error("Phyllo returned an invalid creator handle.");
  if (state.requestedHandle && handle !== state.requestedHandle) {
    throw new Error(`You connected @${handle}, but this route belongs to @${state.requestedHandle}.`);
  }
  const consumed = await db().prepare("UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE state = ? AND consumed_at IS NULL")
    .bind(stateToken).run();
  if (!consumed.meta.changes) return null;
  const routeId = await stableId("route", `${state.platform}:${handle}`);
  const vaultKey = `0x${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pons:${state.platform}:${handle}`)))).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const cachedAvatarUrl = await cacheProfileAvatar(routeId, identity.avatarUrl);
  await db().prepare(
    `INSERT INTO creator_routes (id, platform, normalized_handle, platform_user_id, display_name, avatar_url, status, vault_key, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(platform, normalized_handle) DO UPDATE SET platform_user_id = excluded.platform_user_id, display_name = excluded.display_name, avatar_url = excluded.avatar_url, status = 'verified', verified_at = CURRENT_TIMESTAMP`
  ).bind(routeId, state.platform, handle, identity.platformUserId, identity.displayName ?? null, cachedAvatarUrl ?? identity.avatarUrl ?? null, vaultKey).run();
  const session = randomToken(48);
  await db().prepare("INSERT INTO creator_sessions (id, route_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), routeId, await sha256(session), new Date(Date.now() + 7 * 86400_000).toISOString()).run();
  return {
    cookie: `creator_session=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
    handle,
    platform: state.platform,
    returnTo: state.returnTo,
  };
}
