import { db, getEnv, json, normalizeHandle, normalizePlatform, randomToken } from "@/lib/server";
import { findPhylloWorkPlatform, phylloEnvironment, phylloRequest } from "@/lib/phyllo";

export async function POST(request: Request) {
  try {
    if (!getEnv("PHYLLO_CLIENT_ID") || !getEnv("PHYLLO_CLIENT_SECRET")) {
      return json({ error: "Creator verification is being configured. Please try again shortly." }, { status: 503 });
    }
    const body = await request.json() as { platform?: unknown; handle?: unknown; returnTo?: unknown };
    const platform = normalizePlatform(body.platform);
    if (!platform) return json({ error: "Choose Instagram or TikTok." }, { status: 400 });
    const requestedHandle = typeof body.handle === "string" && body.handle.trim() ? normalizeHandle(body.handle) : null;
    if (typeof body.handle === "string" && body.handle.trim() && !requestedHandle) return json({ error: "Enter a valid creator handle." }, { status: 400 });
    const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/") && !body.returnTo.startsWith("//") ? body.returnTo : "/creator";
    const state = randomToken(32);
    const externalId = `ponspay-${state}`;
    const workPlatformId = await findPhylloWorkPlatform(platform);
    const user = await phylloRequest("/v1/users", {
      method: "POST",
      body: JSON.stringify({ name: `PONSPAY ${platform} creator`, external_id: externalId }),
    });
    if (typeof user.id !== "string") throw new Error("Phyllo did not return a user ID.");
    const token = await phylloRequest("/v1/sdk-tokens", {
      method: "POST",
      body: JSON.stringify({ user_id: user.id, products: ["IDENTITY"] }),
    });
    if (typeof token.sdk_token !== "string") throw new Error("Phyllo did not return an SDK token.");
    await db().prepare("INSERT INTO oauth_states (state, platform, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(state, platform, user.id, `${returnTo}|${requestedHandle ?? ""}|${workPlatformId}`, new Date(Date.now() + 15 * 60_000).toISOString()).run();
    const response = json({
      state,
      userId: user.id,
      token: token.sdk_token,
      environment: phylloEnvironment(),
      workPlatformId,
    });
    response.headers.append("set-cookie", `phyllo_verification_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "phyllo_session_failed", error: String(error) }));
    return json({ error: error instanceof Error ? error.message : "Creator verification could not start." }, { status: 502 });
  }
}
