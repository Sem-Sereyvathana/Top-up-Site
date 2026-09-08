import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { parseAccountStockText } from "@/lib/accountStockParser";

const accountSchema = z.object({
  gameId: z.string().min(1).optional().nullable(),
  categoryId: z.string().min(1).optional().nullable(),
  title: z.string().min(1),
  rank: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  priceUsd: z.number().positive(),
  sold: z.boolean().default(false),
  stockMode: z.enum(["UNIQUE", "MULTI"]).default("UNIQUE"),
  stock: z.number().int().min(0).default(1),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  deliveryMode: z.enum(["DIRECT", "MANUAL"]).default("MANUAL"),
  // Admin-only login handover, only ever sent back to a buyer once their
  // order is PAID and this account's deliveryMode = "DIRECT". Only used for
  // stockMode = "UNIQUE" — "MULTI" + "DIRECT" accounts are stocked one login
  // per unit via the Auto Top Up pool (GameAccountStockItem) instead.
  credentials: z.string().optional().nullable(),
  // Optional: accounts pasted/dropped into the Auto Top Up box while
  // creating a brand-new MULTI + DIRECT listing, added as stock right after
  // the account itself is created.
  stockText: z.string().optional().nullable(),
});

// Moved under /api/admin/* so middleware.ts's admin auth guard covers it
// (this used to live at /api/accounts, reachable by anyone). Now that it's
// authenticated, `credentials` is safe to return here the same way
// /api/admin/game-items and /api/admin/games already do — no more stripping,
// so the edit form correctly prefills the saved credentials again.
export async function GET(req) {
  const gameId = req.nextUrl.searchParams.get("gameId");
  // Archived = admin deleted an account that still had order history (see
  // DELETE handler), so it's hidden from admin everywhere from now on —
  // only its order rows (with their own snapshotted title/price) still
  // reference it.
  const accounts = await prisma.gameAccount.findMany({
    where: { archived: false, ...(gameId ? { gameId } : {}) },
    include: {
      Game: { select: { name: true, slug: true } },
      Category: { select: { name: true, slug: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(accounts);
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { stockText, ...data } = parsed.data;
  const isPooled = data.stockMode === "MULTI" && data.deliveryMode === "DIRECT";
  if (isPooled) {
    // Pool-based accounts start empty and get their count entirely from
    // real stock units below — a typed-in number here would just be a lie
    // about what's actually available to hand over.
    data.stock = 0;
    data.credentials = null;
  }

  let account = await prisma.gameAccount.create({ data });

  if (isPooled && stockText && stockText.trim()) {
    const creds = parseAccountStockText(stockText);
    if (creds.length > 0) {
      await prisma.$transaction([
        prisma.gameAccountStockItem.createMany({
          data: creds.map((c) => ({
            gameAccountId: account.id,
            username: c.username,
            password: c.password,
            notes: c.notes || null,
          })),
        }),
        prisma.gameAccount.update({ where: { id: account.id }, data: { stock: creds.length } }),
      ]);
      account = { ...account, stock: creds.length };
    }
  }

  await writeAudit({ action: "game-account.create", targetType: "gameAccount", targetId: account.id });
  return NextResponse.json(account);
}
