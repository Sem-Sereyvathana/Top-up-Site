import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const adjustSchema = z.object({
  op: z.enum(["add", "remove", "set"]),
  amount: z.number().int().min(0),
});

export async function GET() {
  const stock = await prisma.robuxStock.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return NextResponse.json(stock);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const { op, amount } = parsed.data;

  const current = await prisma.robuxStock.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  const nextTotal =
    op === "add" ? current.totalRobux + amount
    : op === "remove" ? Math.max(0, current.totalRobux - amount)
    : amount; // "set"

  const updated = await prisma.robuxStock.update({
    where: { id: 1 },
    data: { totalRobux: nextTotal },
  });

  await writeAudit({
    action: `robux_stock.${op}`,
    targetType: "robux_stock",
    targetId: "1",
    details: { amount, before: current.totalRobux, after: updated.totalRobux },
  });

  return NextResponse.json(updated);
}
