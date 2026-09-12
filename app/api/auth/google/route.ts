export const dynamic = "force-dynamic";

import { buildGoogleAuthUrl } from "@/lib/googleAuth";
import { NextRequest, NextResponse } from "next/server";

const STATE_COOKIE = "google_oauth_state";
const NEXT_COOKIE = "google_oauth_next";

function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/account";
  return next;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const next = safeNext(searchParams.get("next"));

  const state = crypto.randomUUID();
  const redirectUri = `${origin}/api/auth/google/callback`;
  const authUrl = buildGoogleAuthUrl(redirectUri, state);

  const res = NextResponse.redirect(authUrl);
  // Short-lived, httpOnly cookies just to survive the round trip to Google
  // and back. `state` guards against CSRF; `next` remembers where to send
  // the user afterwards without trusting a query param on the callback.
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  res.cookies.set(NEXT_COOKIE, next, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  return res;
}
