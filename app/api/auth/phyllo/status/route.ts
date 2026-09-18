import { completePhylloVerification, discoverConnectedPhylloAccount } from "@/lib/creator-verification";
import { db, json, readCookie } from "@/lib/server";

const clearVerificationCookie = "phyllo_verification_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { state?: unknown; cancel?: unknown };
    const state = typeof body.state === "string" && body.state ? body.state : readCookie(request, "phyllo_verification_state");
    if (!state) return json({ idle: true });
    if (body.cancel === true) {
      await db().prepare("UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE state = ? AND consumed_at IS NULL").bind(state).run();
      const response = json({ cancelled: true });
      response.headers.append("set-cookie", clearVerificationCookie);
      return response;
    }
    const accountId = await discoverConnectedPhylloAccount(state);
    if (accountId === undefined) {
      const response = json({ error: "This verification session expired. Start again." }, { status: 410 });
      response.headers.append("set-cookie", clearVerificationCookie);
      return response;
    }
    if (!accountId) return json({ pending: true, phase: "connection" }, { status: 202 });
    const completed = await completePhylloVerification(state, accountId);
    if (!completed) return json({ pending: true, phase: "profile" }, { status: 202 });
    const response = json({ ok: true, returnTo: completed.returnTo, platform: completed.platform, handle: completed.handle });
    response.headers.append("set-cookie", completed.cookie);
    response.headers.append("set-cookie", clearVerificationCookie);
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "phyllo_status_failed", error: String(error) }));
    return json({ error: error instanceof Error ? error.message : "Creator verification could not be recovered." }, { status: 502 });
  }
}
