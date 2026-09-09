import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "sharustore_admin";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Admin login + TOTP rate limiting used to live here, but middleware
  // runs on the Edge runtime, which can't use Prisma — so it was backed by
  // an in-memory Map that didn't actually work across Vercel's separate
  // serverless instances. It now lives in the route handlers themselves
  // (app/api/admin/auth/route.ts and app/api/admin/auth/totp/route.ts),
  // which already run in the Node runtime and already use Prisma, so the
  // persistent DB-backed limiter in lib/rateLimit.ts can be used there
  // directly. Nothing else changes here — those two paths are still
  // exempted from the session check below, same as before.

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
