import { absoluteAppUrl, cacheProfileAvatar, db, getEnv, normalizeHandle, normalizePlatform, randomToken, sha256, stableId } from "@/lib/server";

type Identity = { userId: string; username: string; displayName?: string; avatarUrl?: string };

async function instagramIdentity(code: string, callback: string): Promise<Identity> {
  const clientId = getEnv("INSTAGRAM_CLIENT_ID");
  const clientSecret = getEnv("INSTAGRAM_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Instagram credentials unavailable");
  const form = new FormData();
  form.set("client_id", clientId); form.set("client_secret", clientSecret); form.set("grant_type", "authorization_code");
  form.set("redirect_uri", callback); form.set("code", code);
  const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
  if (!tokenResponse.ok) throw new Error(`Instagram token exchange failed: ${tokenResponse.status}`);
  const token = await tokenResponse.json() as { access_token?: string; user_id?: string | number };
  if (!token.access_token) throw new Error("Instagram access token missing");
  const profileResponse = await fetch("https://graph.instagram.com/me?fields=user_id,username,name,profile_picture_url", { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new Error(`Instagram profile lookup failed: ${profileResponse.status}`);
  const profile = await profileResponse.json() as { user_id?: string; id?: string; username?: string; name?: string; profile_picture_url?: string };
  if (!profile.username || !(profile.user_id ?? profile.id ?? token.user_id)) throw new Error("Instagram identity incomplete");
  return { userId: String(profile.user_id ?? profile.id ?? token.user_id), username: profile.username, displayName: profile.name, avatarUrl: profile.profile_picture_url };
}

async function tiktokIdentity(code: string, callback: string): Promise<Identity> {
  const clientKey = getEnv("TIKTOK_CLIENT_KEY");
  const clientSecret = getEnv("TIKTOK_CLIENT_SECRET");
  if (!clientKey || !clientSecret) throw new Error("TikTok credentials unavailable");
  const body = new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: callback });
  const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!tokenResponse.ok) throw new Error(`TikTok token exchange failed: ${tokenResponse.status}`);
  const token = await tokenResponse.json() as { access_token?: string; open_id?: string };
  if (!token.access_token) throw new Error("TikTok access token missing");
  const profileResponse = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username", { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new Error(`TikTok profile lookup failed: ${profileResponse.status}`);
  const profile = await profileResponse.json() as { data?: { user?: { open_id?: string; username?: string; display_name?: string; avatar_url?: string } } };
  const user = profile.data?.user;
  if (!user?.username || !(user.open_id ?? token.open_id)) throw new Error("TikTok identity incomplete");
  return { userId: String(user.open_id ?? token.open_id), username: user.username, displayName: user.display_name, avatarUrl: user.avatar_url };
}

export async function GET(request: Request, context: { params: Promise<{ platform: string }> }) {
  const platform = normalizePlatform((await context.params).platform);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!platform || !state || !code) return new Response("Invalid OAuth callback", { status: 400 });
  try {
    const oauth = await db().prepare("SELECT return_to AS returnTo FROM oauth_states WHERE state = ? AND platform = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP")
      .bind(state, platform).first<{ returnTo: string }>();
    if (!oauth) return new Response("This verification link expired. Start again.", { status: 400 });
    await db().prepare("UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE state = ? AND consumed_at IS NULL").bind(state).run();
    const callback = `${absoluteAppUrl(request)}/api/auth/${platform}/callback`;
    const identity = platform === "instagram" ? await instagramIdentity(code, callback) : await tiktokIdentity(code, callback);
    const handle = normalizeHandle(identity.username);
    if (!handle) throw new Error("Invalid platform username");
    const routeId = await stableId("route", `${platform}:${handle}`);
    const vaultKey = `0x${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pons:${platform}:${handle}`)))).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    const cachedAvatarUrl = await cacheProfileAvatar(routeId, identity.avatarUrl);
    await db().prepare(
      `INSERT INTO creator_routes (id, platform, normalized_handle, platform_user_id, display_name, avatar_url, status, vault_key, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(platform, normalized_handle) DO UPDATE SET platform_user_id = excluded.platform_user_id, display_name = excluded.display_name, avatar_url = excluded.avatar_url, status = 'verified', verified_at = CURRENT_TIMESTAMP`
    ).bind(routeId, platform, handle, identity.userId, identity.displayName ?? null, cachedAvatarUrl ?? identity.avatarUrl ?? null, vaultKey).run();
    const session = randomToken(48);
    const sessionId = crypto.randomUUID();
    await db().prepare("INSERT INTO creator_sessions (id, route_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
      .bind(sessionId, routeId, await sha256(session), new Date(Date.now() + 7 * 86400_000).toISOString()).run();
    const response = Response.redirect(new URL(oauth.returnTo, absoluteAppUrl(request)), 302);
    response.headers.append("set-cookie", `creator_session=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "oauth_callback_failed", platform, error: String(error) }));
    return new Response("Creator verification failed. Please try again.", { status: 502 });
  }
}
