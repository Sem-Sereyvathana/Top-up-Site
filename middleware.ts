import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "rithtopup_admin";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
