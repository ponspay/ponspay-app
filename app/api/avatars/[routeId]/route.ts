import { bucket } from "@/lib/server";

export async function GET(_request: Request, context: { params: Promise<{ routeId: string }> }) {
  const routeId = (await context.params).routeId;
  if (!/^route_[A-Za-z0-9_-]{32}$/.test(routeId)) return new Response("Not found", { status: 404 });
  const object = await bucket().get(`creator-avatars/${routeId}`);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  return new Response(object.body, { headers });
}
