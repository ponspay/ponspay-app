import { absoluteAppUrl, db, getEnv, json, normalizePlatform, randomToken } from "@/lib/server";

export async function GET(request: Request, context: { params: Promise<{ platform: string }> }) {
  const platform = normalizePlatform((await context.params).platform);
  if (!platform) return json({ error: "Unsupported creator platform." }, { status: 404 });
  const clientId = platform === "instagram" ? getEnv("INSTAGRAM_CLIENT_ID") : getEnv("TIKTOK_CLIENT_KEY");
  if (!clientId) return json({ error: `${platform === "instagram" ? "Instagram" : "TikTok"} verification is awaiting platform credentials.` }, { status: 503 });

  const state = randomToken();
  const verifier = randomToken(48);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const returnTo = new URL(request.url).searchParams.get("returnTo")?.startsWith("/") ? new URL(request.url).searchParams.get("returnTo")! : "/";
  await db().prepare("INSERT INTO oauth_states (state, platform, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(state, platform, verifier, returnTo, expiresAt).run();

  const callback = `${absoluteAppUrl(request)}/api/auth/${platform}/callback`;
  const authorize = platform === "instagram"
    ? new URL("https://www.instagram.com/oauth/authorize")
    : new URL("https://www.tiktok.com/v2/auth/authorize/");
  authorize.searchParams.set(platform === "instagram" ? "client_id" : "client_key", clientId);
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", platform === "instagram" ? "instagram_business_basic" : "user.info.basic,user.info.profile");
  authorize.searchParams.set("state", state);
  return Response.redirect(authorize, 302);
}
