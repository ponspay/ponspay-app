import { db, publicJson } from "@/lib/server";

export async function GET() {
  try {
    const [launches, creators, payments, batches, daily] = await Promise.all([
      db().prepare("SELECT COUNT(*) AS total FROM launch_links WHERE status = 'live'").first<{ total: number }>(),
      db().prepare("SELECT COUNT(*) AS total FROM creator_routes WHERE status = 'verified'").first<{ total: number }>(),
      db().prepare("SELECT COUNT(*) AS total FROM withdrawal_requests WHERE status = 'confirmed'").first<{ total: number }>(),
      db().prepare("SELECT status, COUNT(*) AS total FROM fee_batches GROUP BY status").all<{ status: string; total: number }>(),
      db().prepare("SELECT DATE(created_at) AS day, COUNT(*) AS total FROM launch_links WHERE created_at >= DATETIME('now', '-13 days') GROUP BY DATE(created_at) ORDER BY day").all<{ day: string; total: number }>(),
    ]);
    return publicJson({ launches: launches?.total ?? 0, verifiedCreators: creators?.total ?? 0, confirmedPayments: payments?.total ?? 0, feeBatches: batches.results, dailyLaunches: daily.results }, 5, 15);
  } catch {
    return publicJson({ launches: 0, verifiedCreators: 0, confirmedPayments: 0, feeBatches: [], dailyLaunches: [] }, 10, 30);
  }
}
