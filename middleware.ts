import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "sharustore_admin";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

// Content-Security-Policy, generated fresh per request with a random nonce.
// script-src only trusts <script> tags carrying this request's nonce (Next
// automatically stamps its own inline bootstrap/hydration scripts with it
// once it sees the nonce on the request headers below) — so even if
// somewhere in the app user-supplied content ever ended up on the page
// unescaped, an injected <script> tag has no way to get the nonce and
// simply won't execute. That's the main payoff: it turns a would-be XSS
// into inert text instead of a script that could read cookies, call admin
// APIs, or hijack a logged-in session.
//
// style-src keeps 'unsafe-inline' rather than trying to nonce it — CSP
// nonces only cover <script>/<style> elements, never the `style="..."`
// attribute, and a few components here (RouteProgress, GameFilterBar, the
// admin dashboard bars) set inline style attributes directly. Style-only
// injection is a much lower-severity risk than script injection, so this
// is a deliberate, pragmatic trade-off rather than an oversight.
function buildCsp(nonce: string) {
  // Next.js dev mode (`next dev`) relies on eval() for Fast Refresh/HMR —
  // without 'unsafe-eval' here, the site would work in production but
  // break (blank page / HMR errors) every time you run it locally. Kept
  // out of the production policy, where it isn't needed and would only
  // weaken script-src for no reason.
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' https: data:`,
    `font-src 'self' https://fonts.gstatic.com`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  // Forward the nonce to the app (so Next can tag its own inline scripts
  // with it) and carry the CSP itself on the request too — Next's own CSP
  // detection reads it from here.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  function withCsp(res: NextResponse) {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  function next() {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  }

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
    return next();
  }

  // Guard every other /admin/* page and every /api/admin/* endpoint.
  // (Previously this only matched paths starting with "/admin", which
  // silently excluded "/api/admin/*" — since that starts with "/api", not
  // "/admin" — and let every admin API route through with no auth check
  // at all. The fix: match either prefix explicitly.)
  const isProtected = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (!isProtected) {
    return next();
  }

  // For /api/admin/* we still want to verify token (except auth routes)
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const secret = getSecret();

  if (!token || !secret) {
    if (pathname.startsWith("/api/")) {
      return withCsp(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    return withCsp(NextResponse.redirect(new URL("/admin/login", req.url)));
  }

  try {
    await jwtVerify(token, secret);
    return next();
  } catch {
    if (pathname.startsWith("/api/")) {
      return withCsp(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    return withCsp(NextResponse.redirect(new URL("/admin/login", req.url)));
  }
}

export const config = {
  // Runs on every page and API route except Next's internal static/image
  // assets and common static file extensions served from /public — those
  // don't render HTML/scripts, so they have nothing for a CSP to protect.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|map)$).*)",
  ],
};
