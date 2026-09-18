import { env } from "cloudflare:workers";

export type Platform = "instagram" | "tiktok";

export function db(): D1Database {
  if (!env.DB) throw new Error("Database unavailable");
  return env.DB;
}

export function bucket(): R2Bucket {
  if (!env.BUCKET) throw new Error("Object storage unavailable");
  return env.BUCKET;
}

export async function cacheProfileAvatar(routeId: string, sourceUrl?: string): Promise<string | null> {
  if (!sourceUrl || !env.BUCKET) return null;
  const response = await fetch(sourceUrl, { redirect: "follow" });
  if (!response.ok || !response.body) return null;
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!contentType.startsWith("image/") || (length && length > 2_000_000)) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2_000_000) return null;
  await env.BUCKET.put(`creator-avatars/${routeId}`, bytes, { httpMetadata: { contentType, cacheControl: "public, max-age=86400" } });
  return `/api/avatars/${routeId}`;
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return Response.json(data, { ...init, headers });
}

export function publicJson(data: unknown, maxAgeSeconds: number, staleSeconds = maxAgeSeconds * 4) {
  const response = Response.json(data);
  response.headers.set("cache-control", `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${staleSeconds}`);
  response.headers.set("content-type", "application/json; charset=utf-8");
  return response;
}

export function normalizePlatform(value: unknown): Platform | null {
  return value === "instagram" || value === "tiktok" ? value : null;
}

export function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com)\//i, "").replace(/^@/, "").split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9._]{2,30}$/.test(handle) ? handle : null;
}

export function normalizeAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

export function normalizeHash(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64Url(buffer);
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function sha256Hex(value: string): Promise<`0x${string}`> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function stableId(prefix: string, value: string): Promise<string> {
  return `${prefix}_${(await sha256(value)).slice(0, 32)}`;
}

export function getEnv(name: keyof Cloudflare.Env): string | null {
  const value = env[name];
  return typeof value === "string" && value.length ? value : null;
}

export function absoluteAppUrl(request: Request): string {
  return getEnv("PUBLIC_APP_URL") ?? new URL(request.url).origin;
}

export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function requireCreatorSession(request: Request): Promise<{ routeId: string } | null> {
  const token = readCookie(request, "creator_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return db().prepare(
    "SELECT route_id AS routeId FROM creator_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1"
  ).bind(tokenHash).first<{ routeId: string }>();
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return [...sig].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length % 2 !== 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 2) diff |= Number.parseInt(a.slice(i, i + 2), 16) ^ Number.parseInt(b.slice(i, i + 2), 16);
  return diff === 0;
}
