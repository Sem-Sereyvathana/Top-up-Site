import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";

// /api/admin/* is already session-guarded by middleware.ts.

const schema = z.object({
  enabled: z.boolean(),
  imageUrl: z.string().trim().max(2000).nullable().optional(),
  title: z.string().trim().max(200),
  body: z.string().max(2000).nullable().optional(),
  bullets: z.string().max(2000).nullable().optional(),
  closeLabel: z.string().trim().min(1).max(60),
});

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const popup = await prisma.signInPopup.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return NextResponse.json(popup);
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Invalid";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const d = parsed.data;
  const data = {
    enabled: d.enabled,
    imageUrl: d.imageUrl || null,
    title: d.title,
    body: d.body?.trim() ? d.body : null,
    bullets: d.bullets?.trim() ? d.bullets : null,
    closeLabel: d.closeLabel,
  };

  const popup = await prisma.signInPopup.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  await writeAudit({
    action: "signin-popup.update",
    targetType: "signin-popup",
    targetId: "1",
    details: { enabled: popup.enabled },
  });
  return NextResponse.json(popup);
}
