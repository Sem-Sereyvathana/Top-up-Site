import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { adminAdjust, verifyLedgerIntegrity } from "@/lib/wallet";

// Admin wallet view + manual adjust.
//   GET  ?userId=…  → balance, ledger history, integrity check
//   POST            → manual adjust (requires a note; audited)

export async function GET(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, phone: true, name: true, walletCents: true, isReseller: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const [transactions, integrity] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    verifyLedgerIntegrity(userId),
  ]);

  return NextResponse.json({
    user,
    balanceCents: user.walletCents,
    transactions,
    integrityOk: integrity.ok,
  });
}

const adjustSchema = z.object({
  userId: z.string().min(1),
  // Signed cents: positive credit, negative deduction.
  deltaCents: z.number().int().refine((v) => v !== 0, "delta must be non-zero"),
  note: z.string().trim().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request — a note is required" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const result = await adminAdjust(user.id, parsed.data.deltaCents, parsed.data.note);
  if (!result.ok) {
    const msg =
      result.error === "INSUFFICIENT_FUNDS"
        ? "Deduction would make the wallet negative"
        : result.error === "NOTE_REQUIRED"
          ? "A note is required for wallet adjustments"
          : "Could not adjust the wallet. Please try again.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await writeAudit({
    action: "user.wallet.adjust",
    targetType: "user",
    targetId: user.id,
    details: `${parsed.data.deltaCents > 0 ? "+" : ""}${(parsed.data.deltaCents / 100).toFixed(2)} USD — ${parsed.data.note}`,
  });

  return NextResponse.json({ balanceCents: result.balanceCents });
}
