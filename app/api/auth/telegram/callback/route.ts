import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { createUserSession, setUserSessionCookie } from "@/lib/userAuth";
import { verifyTelegramAuth, TelegramAuthPayload } from "@/lib/telegramAuth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";

// Handles the redirect Telegram sends the browser back to after the user
// approves login on oauth.telegram.org. Same signed payload as the old
// widget, just delivered as query params on a GET instead of a JS
// callback — so it's verified the exact same way (see lib/telegramAuth.ts).
const telegramAuthSchema = z.object({
  id: z.coerce.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.coerce.number(),
  hash: z.string(),
});

function safeNext(next: string | null): string {
  // Only ever redirect to a relative path on our own site.
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/account";
  return next;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const next = safeNext(searchParams.get("next"));
  const loginUrl = new URL("/login", origin);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`telegram-auth:${ip}`, 15, 10 * 60 * 1000))) {
    loginUrl.searchParams.set("error", "Too many attempts. Please wait a few minutes and try again.");
    return NextResponse.redirect(loginUrl);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN is not set");
    loginUrl.searchParams.set("error", "Telegram login is not available right now");
    return NextResponse.redirect(loginUrl);
  }

  const rawParams = Object.fromEntries(searchParams.entries());
  const parsed = telegramAuthSchema.safeParse(rawParams);
  if (!parsed.success) {
    loginUrl.searchParams.set("error", "Invalid Telegram login response");
    return NextResponse.redirect(loginUrl);
  }

  const payload = parsed.data as TelegramAuthPayload;
  const { valid } = verifyTelegramAuth(payload, botToken);
  if (!valid) {
    loginUrl.searchParams.set("error", "Could not verify Telegram login");
    return NextResponse.redirect(loginUrl);
  }

  const telegramId = String(payload.id);
  const displayName = [payload.first_name, payload.last_name].filter(Boolean).join(" ");

  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (user) {
    if (!user.active) {
      loginUrl.searchParams.set("error", "This account has been disabled");
      return NextResponse.redirect(loginUrl);
    }
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        telegramUsername: payload.username ?? user.telegramUsername,
        avatarUrl: payload.photo_url ?? user.avatarUrl,
        name: user.name ?? displayName,
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        telegramId,
        telegramUsername: payload.username,
        avatarUrl: payload.photo_url,
        name: displayName,
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

  return NextResponse.redirect(new URL(next, origin));
}
