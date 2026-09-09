import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { checkRateLimit } from "@/lib/rateLimit";

const SESSION_COOKIE = "sharustore_admin";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rate limit admin login + TOTP verification — 10 attempts per 10
  // minutes per IP. These two POST endpoints are exempted from the
  // session check below (they're how a session gets created in the first
  // place), so without this they'd have zero protection against
  // brute-forcing across many different admin emails, on top of the
  // per-account lockout already in lib/auth.ts.
  if (
    req.method === "POST" &&
    (pathname === "/api/admin/auth" || pathname === "/api/admin/auth/totp")
  ) {
    const ip = clientIp(req);
    if (!checkRateLimit(`admin-auth:${ip}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }
  }

  // Always let the login page and the login/logout API through.
  if (pathname === "/admin/login" || pathname.startsWith("/api/admin/auth")) {
    return NextResponse.next();
  }

  // Guard every other /admin/* page and every /api/admin/* endpoint.
  // (Previously this only matched paths starting with "/admin", which
  // silently excluded "/api/admin/*" — since that starts with "/api", not
  // "/admin" — and let every admin API route through with no auth check
  // at all. The fix: match either prefix explicitly.)
  const isProtected = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (!isProtected) {
    return NextResponse.next();
  }

  // For /api/admin/* we still want to verify token (except auth routes)
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const secret = getSecret();

  if (!token || !secret) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  try {
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
