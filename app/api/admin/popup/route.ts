import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// /api/admin/* is already session-guarded by middleware.ts.

const schema = z.object({
  enabled: z.boolean(),
  imageUrl: z.string().trim().max(2000).nullable().optional(),
  title: z.string().trim().max(200),
  body: z.string().max(2000).nullable().optional(),
  bullets: z.string().max(2000).nullable().optional(),
  telegramUrl: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .refine((v) => !v || /^https?:\/\//i.test(v), {
      message: "Telegram link must start with https:// (e.g. https://t.me/yourchannel)",
    }),
  buttonLabel: z.string().trim().min(1).max(60),
  closeLabel: z.string().trim().min(1).max(60),
  // true = bump the version so visitors who already dismissed it see it again
  reshow: z.boolean().optional(),
});

export async function GET() {
  const popup = await prisma.welcomePopup.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return NextResponse.json(popup);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Invalid";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { reshow, ...d } = parsed.data;
  const data = {
    enabled: d.enabled,
    imageUrl: d.imageUrl || null,
    title: d.title,
    body: d.body?.trim() ? d.body : null,
    bullets: d.bullets?.trim() ? d.bullets : null,
    telegramUrl: d.telegramUrl || null,
    buttonLabel: d.buttonLabel,
    closeLabel: d.closeLabel,
  };

  const popup = await prisma.welcomePopup.upsert({
    where: { id: 1 },
    update: { ...data, ...(reshow ? { version: { increment: 1 } } : {}) },
    create: { id: 1, ...data },
  });
  await writeAudit({
    action: "popup.update",
    targetType: "popup",
    targetId: "1",
    details: { enabled: popup.enabled, version: popup.version },
  });
  return NextResponse.json(popup);
}
