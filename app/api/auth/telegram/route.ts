import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { createUserSession, setUserSessionCookie } from "@/lib/userAuth";
import { verifyTelegramAuth, TelegramAuthPayload } from "@/lib/telegramAuth";
import { getTelegramBotToken } from "@/lib/telegramLogin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

const telegramAuthSchema = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`telegram-auth:${ip}`, 15, 10 * 60 * 1000))) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const botToken = await getTelegramBotToken();
  if (!botToken) {
    // Not configured yet — fail loudly server-side so it's obvious during
    // setup, but don't leak internals to the client.
    console.error("Telegram bot token is not set (Admin → Settings or TELEGRAM_BOT_TOKEN)");
    return NextResponse.json({ error: "Telegram login is not available right now" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = telegramAuthSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const payload = parsed.data as TelegramAuthPayload;
  const { valid } = verifyTelegramAuth(payload, botToken);
  if (!valid) {
    return NextResponse.json({ error: "Could not verify Telegram login" }, { status: 401 });
  }

  const telegramId = String(payload.id);
  const displayName = [payload.first_name, payload.last_name].filter(Boolean).join(" ");

  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (user) {
    if (!user.active) {
      return NextResponse.json({ error: "This account has been disabled" }, { status: 403 });
    }
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        // Keep username/avatar/name fresh in case the person changed them
        // on Telegram since they last signed in.
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

  return NextResponse.json({
    user: { id: user.id, email: user.email, phone: user.phone, name: user.name, points: user.points },
  });
}
