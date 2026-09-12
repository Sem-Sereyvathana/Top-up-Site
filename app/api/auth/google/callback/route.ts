import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { createUserSession, setUserSessionCookie } from "@/lib/userAuth";
import { exchangeGoogleCode } from "@/lib/googleAuth";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

const STATE_COOKIE = "google_oauth_state";
const NEXT_COOKIE = "google_oauth_next";

function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/account";
  return next;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const loginUrl = new URL("/login", origin);

  const storedState = req.cookies.get(STATE_COOKIE)?.value;
  const next = safeNext(req.cookies.get(NEXT_COOKIE)?.value);

  // Always clear the round-trip cookies once we've read them, regardless
  // of outcome below.
  const clearOauthCookies = (res: NextResponse) => {
    res.cookies.delete(STATE_COOKIE);
    res.cookies.delete(NEXT_COOKIE);
    return res;
  };

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`google-auth:${ip}`, 15, 10 * 60 * 1000))) {
    loginUrl.searchParams.set("error", "Too many attempts. Please wait a few minutes and try again.");
    return clearOauthCookies(NextResponse.redirect(loginUrl));
  }

  if (searchParams.get("error")) {
    // User clicked "Cancel" on Google's consent screen — not an error worth logging.
    loginUrl.searchParams.set("error", "Google sign-in was cancelled");
    return clearOauthCookies(NextResponse.redirect(loginUrl));
  }

  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  if (!code || !returnedState || !storedState || returnedState !== storedState) {
    loginUrl.searchParams.set("error", "Invalid Google login response");
    return clearOauthCookies(NextResponse.redirect(loginUrl));
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is not set");
    loginUrl.searchParams.set("error", "Google login is not available right now");
    return clearOauthCookies(NextResponse.redirect(loginUrl));
  }

  let profile;
  try {
    const redirectUri = `${origin}/api/auth/google/callback`;
    profile = await exchangeGoogleCode(code, redirectUri);
  } catch (err) {
    console.error("Google token exchange/verification failed", err);
    loginUrl.searchParams.set("error", "Could not verify Google login");
    return clearOauthCookies(NextResponse.redirect(loginUrl));
  }

  const googleId = profile.sub;

  let user = await prisma.user.findUnique({ where: { googleId } });

  // If there's no account with this Google ID yet, but a verified email
  // matches an existing account (e.g. they signed up with Telegram before),
  // link Google to that same account instead of creating a duplicate.
  if (!user && profile.email && profile.emailVerified) {
    user = await prisma.user.findUnique({ where: { email: profile.email } });
  }

  if (user) {
    if (!user.active) {
      loginUrl.searchParams.set("error", "This account has been disabled");
      return clearOauthCookies(NextResponse.redirect(loginUrl));
    }
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        googleId,
        lastLoginAt: new Date(),
        email: user.email ?? profile.email ?? undefined,
        avatarUrl: profile.picture ?? user.avatarUrl,
        name: user.name ?? profile.name,
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        googleId,
        email: profile.email,
        avatarUrl: profile.picture,
        name: profile.name,
        lastLoginAt: new Date(),
      },
    });
  }

  const token = await createUserSession({
    userId: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
  });
  await setUserSessionCookie(token);

  return clearOauthCookies(NextResponse.redirect(new URL(next, origin)));
}
