import { absoluteAppUrl, bucket, json } from "@/lib/server";

const allowed = new Map([
  ["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/gif", "gif"],
]);

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) return json({ error: "Choose an image file." }, { status: 400 });
  const extension = allowed.get(file.type);
  if (!extension) return json({ error: "Use a PNG, JPG, WebP, or GIF image." }, { status: 415 });
  if (file.size <= 0 || file.size > 2_000_000) return json({ error: "The image must be smaller than 2 MB." }, { status: 413 });
  const id = `${crypto.randomUUID()}.${extension}`;
  await bucket().put(`launch-images/${id}`, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { originalName: file.name.slice(0, 120) },
  });
  return json({ url: `${absoluteAppUrl(request)}/api/uploads/image/${id}` }, { status: 201 });
}
