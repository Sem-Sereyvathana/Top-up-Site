import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";

/**
 * DELETE /api/admin/orders/bulk — wipes orders matching the given filter.
 *
 * Body (all optional):
 *   { status?: "PENDING" | ... | "ALL", confirm: "DELETE" }
 *
 * Without `confirm: "DELETE"` the request is refused — this is a destructive
 * operation and we don't want it triggered by accident or by a bug in a client.
 */
export async function DELETE(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE") {
    return NextResponse.json(
      { error: "Missing confirmation. Resend with { confirm: 'DELETE' }." },
      { status: 400 }
    );
  }

  const status = typeof body.status === "string" ? body.status : "ALL";

  // NEVER delete an order that represents money taken from a customer.
  // Bulk delete exists only to clear abandoned, never-paid orders, so the
  // allowed statuses are hard-restricted here regardless of what the UI
  // (or a crafted request) asks for. PAID / PROCESSING / DELIVERED /
  // REFUNDED are permanent records and must always be kept.
  const DELETABLE_STATUSES = ["PENDING", "FAILED", "CANCELLED"] as const;
  const requestedStatuses =
    status === "ALL" ? [...DELETABLE_STATUSES] : [status];
  const invalid = requestedStatuses.filter(
    (s) => !(DELETABLE_STATUSES as readonly string[]).includes(s)
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error:
          "Only abandoned unpaid orders (PENDING, FAILED, CANCELLED) can be bulk-deleted. " +
          "Paid and delivered orders are permanent records.",
      },
      { status: 400 }
    );
  }

  // Age gate: only orders older than N days may be removed, so a shopper
  // mid-checkout never loses an order that is still in flight. Suggested
  // and default value: 30 days. The owner can raise it from the admin UI
  // (passed in the request body) but never below 30.
  const MIN_AGE_DAYS = 30;
  const ageDays =
    typeof body.olderThanDays === "number" && Number.isFinite(body.olderThanDays)
      ? Math.max(MIN_AGE_DAYS, Math.floor(body.olderThanDays))
      : MIN_AGE_DAYS;
  const cutoff = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);

  // Bulk delete is triggered from the normal automated-game Orders page.
  // Always protect Roblox/Robux orders from being deleted here.
  const robuxGameFilter = {
    OR: [
      { slug: "roblox" },
      { currencyName: { contains: "robux", mode: "insensitive" as const } },
    ],
  };

  const where: any = {
    NOT: { game: robuxGameFilter },
    status: { in: requestedStatuses },
    createdAt: { lt: cutoff },
  };

  // Preview first so the audit entry records exactly what was removed.
  const toDelete = await prisma.order.findMany({
    where,
    select: { id: true },
    take: 5000,
  });
  if (toDelete.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  const result = await prisma.order.deleteMany({
    where: { id: { in: toDelete.map((o) => o.id) } },
  });

  await writeAudit({
    action: "orders.bulk_delete",
    targetType: "order",
    details: `Deleted ${result.count} abandoned unpaid orders (statuses: ${requestedStatuses.join(
      ", "
    )}; older than ${ageDays} days)`,
  });

  return NextResponse.json({ ok: true, deleted: result.count });
}
