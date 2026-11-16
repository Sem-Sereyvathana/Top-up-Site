import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { getCurrentUserRecord } from "@/lib/userAuth";
import { loadPaymentGroup } from "@/lib/paymentGroup";
import { isGiftcardGame } from "@/lib/utils";

// Customer-facing status endpoint for a COMBINED multi-store order
// (Game Items + Accounts, paid together).
//
// Two shapes in one response:
//   * `lines`    — the flat basket, used by the PAYMENT screen (one total).
//   * `receipts` — one independent receipt per part, used by the order page
//                  and History. Each has its own status and updates on its
//                  own; there is no merged receipt and no overall status.
//
// Account credentials are deliberately NOT part of this payload. They are
// only handed out by POST .../reveal, which re-checks ownership and that the
// order is actually paid before returning anything.
//
// Owner-only, exactly like /api/orders/[orderNumber].
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const orderNumber = (await params).orderNumber.toUpperCase();
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`order-lookup:group:${ip}`, 200, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }

  const group = await prisma.paymentGroup.findUnique({ where: { orderNumber } });
  if (!group) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const user = await getCurrentUserRecord();
  if (!user || !group.userId || user.id !== group.userId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const data = await loadPaymentGroup(group.id);
  if (!data) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Admin's support handle, for the "Contact admin on Telegram" button on an
  // item receipt that needs a conversation first. Same public value the
  // single-order endpoints already hand out.
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  // ── Flat basket (payment screen) — gift cards always last. ──
  type Line = {
    kind: "topup" | "item" | "account" | "giftcard";
    title: string;
    detail: string;
    quantity: number;
    amountUsd: number;
    status: string;
    // Gift-card specific: the codes the buyer redeems.
    codes?: string[];
  };
  const lines: Line[] = [];

  for (const o of data.topup) {
    const giftcard = isGiftcardGame(o.game);
    let codes: string[] = [];
    if (giftcard && o.deliveryNote?.startsWith("Giftcard code: ")) {
      codes = o.deliveryNote
        .slice("Giftcard code: ".length)
        .replace(/\s*\[DEMO MODE.*\]$/i, "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
    }
    const isCart = o.items.length > 1;
    lines.push({
      kind: giftcard ? "giftcard" : "topup",
      title: isCart
        ? o.items.map((it) => `${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(", ")
        : o.product.name,
      detail: `${o.game.name}${giftcard ? "" : ` · ID ${o.playerUid}`}`,
      quantity: isCart ? o.items.reduce((s, i) => s + i.quantity, 0) : 1,
      amountUsd: o.amountUsd,
      status: o.status,
      ...(codes.length > 0 ? { codes } : {}),
    });
  }
  for (const o of data.items) {
    lines.push({
      kind: "item",
      title: o.items.map((it) => `${it.name}${it.quantity > 1 ? ` x${it.quantity}` : ""}`).join(", "),
      detail: `Game Item · ${o.buyerUsername}`,
      quantity: o.items.reduce((s, i) => s + i.quantity, 0),
      amountUsd: o.amountUsd,
      status: o.status,
    });
  }
  for (const o of data.accounts) {
    lines.push({
      kind: "account",
      title: o.items.map((it) => `${it.title}${it.quantity > 1 ? ` x${it.quantity}` : ""}`).join(", "),
      detail: "Account",
      quantity: o.items.reduce((s, i) => s + i.quantity, 0),
      amountUsd: o.amountUsd,
      status: o.status,
    });
  }

  // Gift cards pinned to the bottom, as requested.
  lines.sort((a, b) => Number(a.kind === "giftcard") - Number(b.kind === "giftcard"));

  // ── Independent receipts (order page + History) ──
  // An item + account cart is TWO separate receipts that happen to share
  // this page and one History entry. Nothing is merged.
  //
  // Stacking order, per the operator's rules:
  //   * item that needs a conversation first (deliveryMode MANUAL — the
  //     buyer has to tap Telegram to reach the admin) → account first, so
  //     the item that needs action sits last.
  //   * otherwise (the admin sends it alone, nothing for the buyer to tap)
  //     → item first, then the account.
  type Receipt = {
    kind: "item" | "account";
    orderNumber: string;
    title: string;
    detail: string;
    amountUsd: number;
    status: string;
    // Item only.
    needsCustomerContact?: boolean;
    buyerUsername?: string;
    // Account only: whether there is a login to reveal, and which order
    // line to ask the reveal endpoint for.
    hasCredentials?: boolean;
    itemId?: string;
  };
  const receipts: Receipt[] = [];

  for (const o of data.items) {
    receipts.push({
      kind: "item",
      orderNumber: o.orderNumber,
      title: o.items.map((it) => `${it.name}${it.quantity > 1 ? ` x${it.quantity}` : ""}`).join(", "),
      detail: `Game Item · ${o.buyerUsername}`,
      amountUsd: o.amountUsd,
      status: o.status,
      needsCustomerContact: o.deliveryMode === "MANUAL",
      buyerUsername: o.buyerUsername,
    });
  }
  for (const o of data.accounts) {
    // One receipt per account line so each login can be revealed on its own
    // (a cart can hold several different accounts).
    if (o.items.length === 0) {
      receipts.push({
        kind: "account",
        orderNumber: o.orderNumber,
        title: "Account",
        detail: "Account login",
        amountUsd: o.amountUsd,
        status: o.status,
        hasCredentials: false,
      });
      continue;
    }
    for (const line of o.items) {
      receipts.push({
        kind: "account",
        orderNumber: o.orderNumber,
        title: line.quantity > 1 ? `${line.title} x${line.quantity}` : line.title,
        detail: "Account login",
        amountUsd: line.unitPriceUsd * line.quantity,
        status: o.status,
        hasCredentials: true,
        itemId: line.id,
      });
    }
  }

  const itemNeedsContact = receipts.some((r) => r.kind === "item" && r.needsCustomerContact);
  receipts.sort((a, b) => {
    if (a.kind === b.kind) return 0;
    if (itemNeedsContact) return a.kind === "account" ? -1 : 1;
    return a.kind === "item" ? -1 : 1;
  });

  // Whole-group status for the PAYMENT screen only (it has to know when the
  // money has landed). The order page uses the per-receipt statuses.
  const order = ["PENDING", "PAID", "PROCESSING", "DELIVERED"];
  const worst = lines.reduce((acc, l) => {
    const i = order.indexOf(l.status);
    return i === -1 ? acc : Math.min(acc, i);
  }, order.length - 1);

  return NextResponse.json({
    orderNumber: group.orderNumber,
    kind: "group",
    status: group.status === "PAID" ? order[Math.max(worst, 1)] : group.status,
    amountUsd: group.amountUsd,
    amountKhr: group.amountKhr,
    paymentMethod: group.paymentMethod,
    // Needed by the group payment screen's simulate button (dev mode).
    paymentRef: group.paymentRef,
    paymentUrl: group.paymentUrl,
    qrString: group.qrString,
    paymentExpiresAt: group.paymentExpiresAt,
    createdAt: group.createdAt,
    paidAt: group.paidAt,
    supportTelegram: settings?.supportTelegram ?? null,
    lines,
    receipts,
  });
}
