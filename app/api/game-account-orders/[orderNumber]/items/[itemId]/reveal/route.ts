import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { getCurrentUserRecord } from "@/lib/userAuth";

// Reveals the login for ONE account line of a combined (GRP-) order.
//
// Why this exists: the order page and History must mask the email:password
// by default and only show it when the buyer asks. If the credentials were
// shipped in the page payload and merely hidden with CSS/state, they would
// already be sitting in the browser (and in any log, cache or saved copy) —
// masking the UI would protect nothing. So the credentials never leave the
// server until this endpoint is called, and this endpoint checks, on the
// server, that:
//   * the requester is signed in,
//   * the order belongs to them (and the group it was paid in does too),
//   * the payment has actually landed (PAID or DELIVERED), and
//   * it only ever returns that one line's login.
//
// Every failure is a flat 404/409 — never a hint about another buyer's order.

const REVEAL_STATUSES = new Set(["PAID", "DELIVERED"]);

// Same "Username/Email: ...\nPassword: ...\nNotes: ..." shape the receipt
// parses elsewhere; MULTI accounts hand over one login per unit and the UI
// splits on the separator.
function formatCredentials(it: {
  gameAccount: { credentials: string | null; stockMode: string };
  stockItems: { username: string; password: string; notes: string | null }[];
}): string | null {
  if (it.gameAccount.stockMode === "MULTI") {
    if (it.stockItems.length === 0) return null;
    return it.stockItems
      .map((s) => {
        const lines = [`Username/Email: ${s.username}`, `Password: ${s.password}`];
        if (s.notes) lines.push(`Notes: ${s.notes}`);
        return lines.join("\n");
      })
      .join("\n---\n");
  }
  return it.gameAccount.credentials;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string; itemId: string  }> }
) {
  const { orderNumber, itemId } = await params;
  // Tight limit: this response contains a working login.
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`order-reveal:${ip}`, 30, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }

  const order = await prisma.gameAccountOrder.findUnique({
    where: { orderNumber: orderNumber.toUpperCase() },
    include: { items: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Owner-only. A signed-out visitor, or the owner of a different order,
  // gets the same 404 as a non-existent order.
  const user = await getCurrentUserRecord();
  if (!user || !order.userId || user.id !== order.userId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Look the line up scoped to THIS order, so an id from another order can
  // never be used to pull someone else's login.
  const line = order.items.find((it) => it.id === itemId);
  if (!line) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A combined order is only really paid once the group is paid; checking
  // the child status alone would be enough in practice (the group finalizer
  // sets it), but a group that is still PENDING must never reveal anything.
  if (order.paymentGroupId) {
    const group = await prisma.paymentGroup.findUnique({
      where: { id: order.paymentGroupId },
      select: { status: true, userId: true },
    });
    if (!group || group.userId !== user.id) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (!REVEAL_STATUSES.has(group.status)) {
      return NextResponse.json({ error: "This order isn't paid yet." }, { status: 409 });
    }
  }

  if (!REVEAL_STATUSES.has(order.status)) {
    return NextResponse.json({ error: "This order isn't paid yet." }, { status: 409 });
  }

  const withStock = await prisma.gameAccountOrderItem.findUnique({
    where: { id: line.id },
    select: {
      gameAccount: { select: { credentials: true, stockMode: true } },
      stockItems: { select: { username: true, password: true, notes: true } },
    },
  });
  if (!withStock) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const credentials = formatCredentials(withStock);
  if (!credentials) {
    return NextResponse.json({ error: "This login isn't ready yet." }, { status: 409 });
  }

  // Never cache a credential response anywhere.
  return NextResponse.json(
    { credentials },
    { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } }
  );
}
