import { json, readCookie } from "@/lib/server";
import { completePhylloVerification } from "@/lib/creator-verification";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { state?: unknown; accountId?: unknown; workPlatformId?: unknown; userId?: unknown };
    const state = typeof body.state === "string" && body.state
      ? body.state
      : readCookie(request, "phyllo_verification_state");
    if (!state || ![body.accountId, body.workPlatformId, body.userId].every((value) => typeof value === "string" && value.length > 0)) {
      return json({ error: "The verification result was incomplete." }, { status: 400 });
    }
    const completed = await completePhylloVerification(state, String(body.accountId), {
      userId: String(body.userId),
      workPlatformId: String(body.workPlatformId),
    });
    if (!completed) return json({ error: "Your verified profile is still syncing. Retrying…", retryable: true }, { status: 409 });
    const response = json({ ok: true, returnTo: completed.returnTo, platform: completed.platform, handle: completed.handle });
    response.headers.append("set-cookie", completed.cookie);
    response.headers.append("set-cookie", "phyllo_verification_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "phyllo_complete_failed", error: String(error) }));
    return json({ error: "Creator verification could not be completed. Please try again." }, { status: 502 });
  }
}
