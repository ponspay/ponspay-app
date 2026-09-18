import { bucket } from "@/lib/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = (await context.params).id;
  if (!/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(id)) return new Response("Not found", { status: 404 });
  const object = await bucket().get(`launch-images/${id}`);
  if (!object?.body) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
