import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";

const settingsSchema = z.object({
  siteName: z.string().min(1).optional(),
  logoUrl: z.string().nullable().optional(),
  exchangeRate: z.number().positive().optional(),
  supportTelegram: z.string().optional(),
  supportChannel: z.string().nullable().optional(),
  supportEmail: z.string().optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: z.string().nullable().optional(),
  announcement: z.string().nullable().optional(),
  announcementTone: z.enum(["info", "warning", "promo"]).nullable().optional(),
  telegramBotToken: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
  // Proof-channel receipts: destination chat id (uses the same bot token).
  receiptTelegramChatId: z.string().nullable().optional(),
  // "How to redeem" video for gift-card orders (direct URL).
  redeemVideoUrl: z.string().nullable().optional(),
  pointsPerUsd: z.number().min(0).optional(),
  pointsRedeemRate: z.number().positive().optional(),
  minRedeemPoints: z.number().int().min(0).optional(),
});

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  // NEVER send the bot token to the browser — the settings page is read by
  // the admin, but any XSS or accidental copy would leak a live Telegram
  // bot credential. The client sends "" to mean "leave unchanged"; a real
  // new value means "replace".
  const { telegramBotToken, ...rest } = settings;
  return NextResponse.json({
    ...rest,
    telegramBotToken: null,
    telegramBotTokenSet: Boolean(telegramBotToken),
  });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }

  // "" (or an omitted field) = leave the stored token untouched; null would
  // have wiped it on every save of unrelated settings, and a non-empty
  // string replaces it. The token can also simply come from the
  // TELEGRAM_BOT_TOKEN env variable (lib/telegram.ts prefers the DB value
  // but falls back to the env var), so clearing here is safe.
  const { telegramBotToken, ...rest } = parsed.data;
  const updateData = {
    ...rest,
    ...(telegramBotToken === undefined || telegramBotToken === ""
      ? {}
      : { telegramBotToken }),
  };

  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    update: updateData,
    create: { id: 1, ...updateData },
  });
  const { telegramBotToken: _stored, ...safe } = settings;
  return NextResponse.json({
    ...safe,
    telegramBotToken: null,
    telegramBotTokenSet: Boolean(_stored),
  });
}
