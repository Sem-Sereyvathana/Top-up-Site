import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireAdminApi } from "@/lib/auth";

const updateSchema = z.object({
  gameId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).optional(),
  rank: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  priceUsd: z.number().positive().optional(),
  sold: z.boolean().optional(),
  stockMode: z.enum(["UNIQUE", "MULTI"]).optional(),
  stock: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  // Manual delivery no longer exists — DIRECT is the only mode.
  deliveryMode: z.enum(["DIRECT"]).optional(),
  credentials: z.string().optional().nullable(),
});

export async function PATCH(req, { params }) {
  const { id } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }
  const data = { ...parsed.data };

  const existing = await prisma.gameAccount.findUnique({
    where: { id: id },
    select: { stockMode: true, deliveryMode: true },
  });
  const nextStockMode = data.stockMode ?? existing?.stockMode;
  const nextDeliveryMode = data.deliveryMode ?? existing?.deliveryMode;
  if (nextStockMode === "MULTI" && nextDeliveryMode === "DIRECT") {
    // Stock for these accounts only ever changes via the Auto Top Up pool
    // (add/remove stock units) — never a typed-in number, so ignore any
    // stray value here rather than let it drift from the real count.
    delete data.stock;
    delete data.credentials;
  }

  const account = await prisma.gameAccount.update({
    where: { id: id },
    data,
  });
  // Log only WHICH fields changed — never the values themselves. The
  // credentials field holds plaintext game logins, which must never be
  // written into the audit log.
  await writeAudit({
    action: "game-account.update",
    targetType: "gameAccount",
    targetId: id,
    details: Object.keys(parsed.data).join(", "),
  });
  // Now behind admin auth (see route.js in the parent folder) — safe to
  // echo credentials back like every other admin CRUD route does.
  return NextResponse.json(account);
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  try {
    await prisma.gameAccount.delete({ where: { id: id } });
  } catch (err) {
    // P2025 = record already gone (e.g. double-click delete) — treat as
    // success since the end state is what the admin wanted anyway.
    if (err?.code === "P2025") {
      return NextResponse.json({ ok: true });
    }
    // P2003 = foreign key constraint failed — this account has order
    // history (GameAccountOrderItem rows reference it), so hard-deleting
    // would orphan those rows (or just throw, as it did here). Order
    // records need to keep pointing at a real account row, but the admin
    // still wants it gone from view — so archive it instead: hidden from
    // every admin list from now on, while the row (and the order history
    // that points at it) stays intact.
    if (err?.code === "P2003") {
      await prisma.gameAccount.update({
        where: { id: id },
        data: { archived: true, active: false },
      });
      await writeAudit({ action: "game-account.archive", targetType: "gameAccount", targetId: id });
      return NextResponse.json({ ok: true, archived: true });
    }
    throw err;
  }
  await writeAudit({ action: "game-account.delete", targetType: "gameAccount", targetId: id });
  return NextResponse.json({ ok: true });
}
