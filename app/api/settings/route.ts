import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getTelegramBotUsername } from "@/lib/telegramLogin";

export const dynamic = "force-dynamic";

// Public counterpart to /api/admin/settings — no auth required, but only
// returns fields that are safe to expose to every visitor. Used by
// components/Header.tsx and components/Footer.tsx for the admin-configured
// logo, site name and support Telegram, and by the sign-in surfaces for the
// Telegram login widget's bot username.
export async function GET() {
  const [settings, telegramBotUsername] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 1 } }).catch(() => null),
    getTelegramBotUsername(),
  ]);
  return NextResponse.json({
    logoUrl: settings?.logoUrl ?? null,
    siteName: settings?.siteName ?? null,
    supportTelegram: settings?.supportTelegram ?? null,
    supportChannel: settings?.supportChannel ?? null,
    // Bot @username (no @) for telegram-widget.js. Null = Telegram sign-in
    // isn't configured yet; the client then falls back to Google only.
    telegramBotUsername,
    // "How to redeem your gift-card code" clip (Admin → Settings).
    redeemVideoUrl: settings?.redeemVideoUrl ?? null,
  });
}
