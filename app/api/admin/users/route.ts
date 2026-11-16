import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";

// Registered (logged-in) customer accounts — separate from the guest
// aggregation in /api/admin/customers, which only groups raw order rows.
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const users = await prisma.user.findMany({
    orderBy: { points: "desc" },
    take: 1000,
    select: {
      id: true,
      email: true,
      phone: true,
      name: true,
      points: true,
      active: true,
      isReseller: true,
      walletCents: true,
      createdAt: true,
      lastLoginAt: true,
      _count: { select: { orders: true } },
    },
  });
  return NextResponse.json({ users });
}

const adjustSchema = z.object({
  userId: z.string().min(1),
  delta: z.number().int().refine((v) => v !== 0, "delta must be non-zero"),
  note: z.string().max(200).optional(),
});

// Manual points adjustment (grant a bonus, correct a mistake, etc). Always
// logged to both the audit log and the user's own points ledger.
export async function POST(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const newBalance = user.points + parsed.data.delta;
  if (newBalance < 0) {
    return NextResponse.json({ error: "Adjustment would make balance negative" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { points: newBalance } }),
    prisma.pointsLedger.create({
      data: {
        userId: user.id,
        type: "ADJUST",
        points: parsed.data.delta,
        note: parsed.data.note || "Manual admin adjustment",
      },
    }),
  ]);

  await writeAudit({
    action: "user.points.adjust",
    targetType: "user",
    targetId: user.id,
    details: `${parsed.data.delta > 0 ? "+" : ""}${parsed.data.delta} pts — ${parsed.data.note || "no note"}`,
  });

  return NextResponse.json({ points: newBalance });
}

const resellerSchema = z.object({
  userId: z.string().min(1),
  isReseller: z.boolean(),
});

// Promote/demote a reseller. Takes effect on the buyer's very next request
// (buyerIsReseller re-reads the flag every time) — no logout needed. Every
// change is audited.
export async function PATCH(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = resellerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (user.isReseller !== parsed.data.isReseller) {
    await prisma.user.update({
      where: { id: user.id },
      data: { isReseller: parsed.data.isReseller },
    });
    await writeAudit({
      action: parsed.data.isReseller ? "user.reseller.granted" : "user.reseller.revoked",
      targetType: "user",
      targetId: user.id,
      details: `${user.email || user.phone || user.id}`,
    });
  }

  return NextResponse.json({ isReseller: parsed.data.isReseller });
}
