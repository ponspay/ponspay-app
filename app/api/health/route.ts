import { db, json } from "@/lib/server";

export async function GET() {
  try {
    await db().prepare("SELECT 1 AS ok").first();
    return json({ ok: true, database: "ready", feeBps: 400, claimWindowHours: 48 });
  } catch (error) {
    console.error(JSON.stringify({ event: "health_failed", error: String(error) }));
    return json({ ok: false, database: "unavailable" }, { status: 503 });
  }
}
