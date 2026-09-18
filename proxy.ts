import { NextResponse, type NextRequest } from "next/server";

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://www.instagram.com https://www.tiktok.com",
    "script-src 'self' 'unsafe-inline' https://cdn.getphyllo.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://api.getphyllo.com https://api.staging.getphyllo.com https://api.sandbox.getphyllo.com",
    "frame-src https://*.getphyllo.com",
    "upgrade-insecure-requests",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "cross-origin-resource-policy": "same-site",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SIGNED_WEBHOOKS = new Set(["/api/fees/ingest", "/api/operator/sync"]);

function secure(response: NextResponse) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  response.headers.set("x-request-id", crypto.randomUUID());
  return response;
}

export function proxy(request: NextRequest) {
  if (request.method === "TRACE" || request.method === "TRACK") {
    return secure(new NextResponse("Method not allowed", { status: 405, headers: { allow: "GET, HEAD, OPTIONS, POST" } }));
  }

  if (request.nextUrl.pathname.startsWith("/api/") && !SAFE_METHODS.has(request.method)) {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    const maxBytes = request.nextUrl.pathname === "/api/uploads/image" ? 2_200_000 : 262_144;
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return secure(NextResponse.json({ error: "Request body is too large." }, { status: 413 }));
    }

    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin && !SIGNED_WEBHOOKS.has(request.nextUrl.pathname)) {
      return secure(NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 }));
    }
  }

  return secure(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.svg).*)"],
};
