import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/userAuth";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { generateOrderNumber, calcKhr } from "@/lib/utils";
import { resolveDeliveryMode } from "@/lib/deliveryMode";
import { initiatePayment } from "@/lib/payment";
import { finalizePaymentGroup, GROUP_PREFIX } from "@/lib/paymentGroup";

// Combined multi-store checkout: ONE payment for a basket of Game Items
// and/or Accounts. Game top-up is deliberately NOT accepted here — it stays
// its own separate checkout (the game page → payment flow), exactly as the
// operator wants: the cart only ever combines items + accounts.
//
// Each part still becomes its own normal order row (so fulfilment, the admin
// queues and the seller-facing pages are untouched); this endpoint only adds
// the `paymentGroupId` that ties them to a single KHPay transaction and a
// single receipt.
//
// Deliberately NOT supported here (they stay on the single-store checkouts):
//   * top-ups — rejected below, not just hidden in the UI, so a hand-made
//     request can't sneak one into the cart either.
//   * promo codes and loyalty points — a discount would have to be split
//     across order tables, and the receipt/refund rules differ.
//   * Game Items / Accounts that need a manual handover conversation are
//     still fine — the order just carries their normal deliveryMode.
//
// Wallet payment IS supported: if the signed-in buyer's balance covers the
// whole basket the group is marked paid immediately and every child is
// finalised in-process.

const createSchema = z.object({
  items: z.array(z.object({ gameItemId: z.string().min(1), quantity: z.number().int().min(1).max(50) })).max(20).optional(),
  accounts: z.array(z.object({ gameAccountId: z.string().min(1), quantity: z.number().int().min(1).max(20) })).max(20).optional(),
  buyerUsername: z.string().max(60).optional(),
  customerContact: z.string().max(120).optional(),
  paymentMethod: z.enum(["KHPAY"]).default("KHPAY"),
  payWithWallet: z.boolean().optional(),
}).strict(); // `.strict()` rejects unknown keys outright — a "topup" field in the body can't be smuggled past.

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { error: "Please sign in to continue.", code: "LOGIN_REQUIRED" },
        { status: 401 }
      );
    }

    if (!(await checkRateLimit(`create-order:group:${currentUser.userId}`, 10, 10 * 60 * 1000, { failClosed: true }))) {
      return NextResponse.json(
        { error: "Too many orders placed. Please wait a bit and try again." },
        { status: 429 }
      );
    }

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const data = parsed.data;

    if (!(data.items && data.items.length) && !(data.accounts && data.accounts.length)) {
      return NextResponse.json({ error: "Nothing to check out." }, { status: 400 });
    }

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (settings?.maintenanceMode) {
      return NextResponse.json(
        { error: settings.maintenanceMessage || "Ordering is temporarily disabled for maintenance." },
        { status: 503 }
      );
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? "unknown";
    const exchangeRate = settings?.exchangeRate ?? 4100;

    // The buyer never types a contact anywhere in the combined checkout —
    // their Telegram username (captured at sign-in) is attached to every
    // child order here, so admin always has a way to reach them on a
    // manual handover. Falls back to whatever contact the client sent
    // (nobody sends it today) then to nothing.
    const buyerRecord = await prisma.user.findUnique({
      where: { id: currentUser.userId },
      select: { telegramUsername: true },
    });
    const autoContact =
      buyerRecord?.telegramUsername
        ? `@${buyerRecord.telegramUsername.replace(/^@+/, "")}`
        : data.customerContact?.trim() || undefined;

    const groupNumber = generateOrderNumber(GROUP_PREFIX.replace("-", ""));
    let groupId: string | null = null;

    const itemPlans: { gameItem: NonNullable<Awaited<ReturnType<typeof prisma.gameItem.findUnique>>>; quantity: number }[] = [];
    if (data.items && data.items.length > 0) {
      const found = await prisma.gameItem.findMany({ where: { id: { in: data.items.map((i) => i.gameItemId) } } });
      const byId = new Map(found.map((i) => [i.id, i]));
      for (const line of data.items) {
        const gi = byId.get(line.gameItemId);
        if (!gi || !gi.active) {
          return NextResponse.json({ error: "One of the selected items is no longer available" }, { status: 404 });
        }
        itemPlans.push({ gameItem: gi, quantity: line.quantity });
      }
    }

    const accountPlans: { account: { id: string; title: string; priceUsd: number; stockMode: string; deliveryMode: string }; quantity: number }[] = [];
    if (data.accounts && data.accounts.length > 0) {
      const found = await prisma.gameAccount.findMany({
        where: { id: { in: data.accounts.map((a) => a.gameAccountId) } },
        select: { id: true, title: true, priceUsd: true, stockMode: true, deliveryMode: true, active: true, sold: true, stock: true, archived: true },
      });
      const byId = new Map(found.map((a) => [a.id, a]));
      for (const line of data.accounts) {
        const acc = byId.get(line.gameAccountId);
        if (!acc || !acc.active || acc.archived || acc.sold) {
          return NextResponse.json({ error: "One of the selected accounts is no longer available" }, { status: 404 });
        }
        // One-of-a-kind accounts can only ever be bought once.
        if (acc.stockMode !== "MULTI" && line.quantity > 1) {
          return NextResponse.json({ error: `"${acc.title}" can only be bought once.` }, { status: 400 });
        }
        if (acc.stockMode === "MULTI" && line.quantity > acc.stock) {
          return NextResponse.json({ error: `Not enough stock for "${acc.title}".` }, { status: 409 });
        }
        accountPlans.push({ account: acc, quantity: line.quantity });
      }
    }

    // ── Totals ──
    const itemsTotal = Math.round(itemPlans.reduce((s, l) => s + l.gameItem.priceUsd * l.quantity, 0) * 100) / 100;
    const accountsTotal = Math.round(accountPlans.reduce((s, l) => s + l.account.priceUsd * l.quantity, 0) * 100) / 100;
    const total = Math.round((itemsTotal + accountsTotal) * 100) / 100;
    if (total <= 0) {
      return NextResponse.json({ error: "Order total must be greater than zero." }, { status: 400 });
    }

    const payWithWallet = !!data.payWithWallet;
    let walletDebitCents = 0;
    if (payWithWallet) {
      walletDebitCents = Math.round(total * 100);
      const user = await prisma.user.findUnique({ where: { id: currentUser.userId }, select: { walletCents: true, active: true } });
      if (!user || !user.active || user.walletCents < walletDebitCents) {
        return NextResponse.json({ error: "Wallet balance is not enough for this order." }, { status: 400 });
      }
    }

    // ── Create the group + children in one transaction. ──
    const created = await prisma.$transaction(async (tx) => {
      const group = await tx.paymentGroup.create({
        data: {
          orderNumber: groupNumber,
          amountUsd: total,
          amountKhr: calcKhr(total, exchangeRate),
          paymentMethod: payWithWallet ? "WALLET" : data.paymentMethod,
          status: payWithWallet ? "PAID" : "PENDING",
          userId: currentUser.userId,
          ...(payWithWallet ? { paidAt: new Date() } : {}),
        },
      });
      groupId = group.id;

      // Wallet debit + ledger row, guarded so two checkouts can't overspend.
      if (payWithWallet) {
        const debit = await tx.user.updateMany({
          where: { id: currentUser.userId, active: true, walletCents: { gte: walletDebitCents } },
          data: { walletCents: { decrement: walletDebitCents } },
        });
        if (debit.count !== 1) throw new Error("WALLET_INSUFFICIENT");
        const fresh = await tx.user.findUnique({ where: { id: currentUser.userId }, select: { walletCents: true } });
        await tx.walletTransaction.create({
          data: {
            userId: currentUser.userId,
            type: "PURCHASE",
            amountCents: -walletDebitCents,
            balanceAfterCents: fresh?.walletCents ?? 0,
            note: `Order ${groupNumber}`,
          },
        });
      }

      if (itemPlans.length > 0) {
        await tx.gameItemOrder.create({
          data: {
            orderNumber: generateOrderNumber("GI"),
            buyerUsername: (data.buyerUsername || currentUser.name || currentUser.email || "customer").slice(0, 60),
            customerContact: autoContact,
            amountUsd: itemsTotal,
            amountKhr: calcKhr(itemsTotal, exchangeRate),
            paymentMethod: payWithWallet ? "WALLET" : data.paymentMethod,
            deliveryMode: resolveDeliveryMode(itemPlans.map((l) => l.gameItem.deliveryMode)),
            status: payWithWallet ? "PAID" : "PENDING",
            ipAddress,
            userAgent,
            userId: currentUser.userId,
            paymentGroupId: group.id,
            ...(payWithWallet ? { paidAt: new Date() } : {}),
            items: {
              create: itemPlans.map((l) => ({
                gameItemId: l.gameItem.id,
                name: l.gameItem.name,
                quantity: l.quantity,
                unitPriceUsd: l.gameItem.priceUsd,
              })),
            },
          },
        });
      }

      if (accountPlans.length > 0) {
        await tx.gameAccountOrder.create({
          data: {
            orderNumber: generateOrderNumber("AC"),
            customerContact: autoContact,
            amountUsd: accountsTotal,
            amountKhr: calcKhr(accountsTotal, exchangeRate),
            paymentMethod: payWithWallet ? "WALLET" : data.paymentMethod,
            deliveryMode: resolveDeliveryMode(accountPlans.map((l) => l.account.deliveryMode)),
            status: payWithWallet ? "PAID" : "PENDING",
            ipAddress,
            userAgent,
            userId: currentUser.userId,
            paymentGroupId: group.id,
            ...(payWithWallet ? { paidAt: new Date() } : {}),
            items: {
              create: accountPlans.map((l) => ({
                gameAccountId: l.account.id,
                title: l.account.title,
                quantity: l.quantity,
                unitPriceUsd: l.account.priceUsd,
              })),
            },
          },
        });
      }

      return group;
    });

    // ── Payment ──
    const requestOrigin = req.nextUrl.origin;
    const envBase = process.env.NEXT_PUBLIC_BASE_URL;
    const isPublicHttpUrl = (value?: string | null): value is string =>
      !!value && /^https?:\/\//i.test(value) &&
      !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(value);
    const baseUrl = (isPublicHttpUrl(envBase) ? envBase : requestOrigin).replace(/\/$/, "");
    const publicUrl = (isPublicHttpUrl(process.env.PUBLIC_APP_URL) ? process.env.PUBLIC_APP_URL! : baseUrl).replace(/\/$/, "");

    if (payWithWallet) {
      // Already paid from the wallet — finalise everything in-process.
      await finalizePaymentGroup(created.id);
      return NextResponse.json({
        orderNumber: created.orderNumber,
        redirectUrl: `${baseUrl}/order/group?number=${created.orderNumber}`,
      });
    }

    const parts: string[] = [];
    if (itemPlans.length > 0) parts.push("Game Items");
    if (accountPlans.length > 0) parts.push("Accounts");

    let khpayPageUrl: string | null = null;
    try {
      const init = await initiatePayment({
        orderNumber: created.orderNumber,
        amountUsd: total,
        method: data.paymentMethod,
        returnUrl: `${publicUrl}/order/group?number=${created.orderNumber}`,
        cancelUrl: `${publicUrl}/`,
        callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
        note: `SHARUSTORE · ${parts.join(" + ")}`,
        metadata: { order_number: created.orderNumber, kind: "group", group_id: created.id },
      });

      if (init.redirectUrl && /^https:\/\/khpay\.site\//i.test(init.redirectUrl)) {
        khpayPageUrl = init.redirectUrl;
      }
      await prisma.paymentGroup.update({
        where: { id: created.id },
        data: {
          paymentRef: init.paymentRef,
          paymentUrl: init.redirectUrl,
          qrString: init.qrString ?? null,
          paymentExpiresAt: init.expiresAt,
        },
      });
    } catch (err) {
      console.warn("[checkout-group] payment init failed, falling back to checkout page:", err);
    }

    return NextResponse.json({
      orderNumber: created.orderNumber,
      // No KHPay page (init failed, or sim mode) — show OUR group payment
      // screen, which renders the group QR and retries the transaction
      // server-side. /checkout/[orderNumber] only knows top-up orders and
      // would 404 on a GRP- number.
      redirectUrl: khpayPageUrl || `${baseUrl}/checkout/group/${created.orderNumber}`,
    });
  } catch (err: any) {
    if (String(err?.message) === "WALLET_INSUFFICIENT") {
      return NextResponse.json({ error: "Wallet balance is not enough for this order." }, { status: 400 });
    }
    console.error("Group checkout error:", err);
    return NextResponse.json({ error: "Could not create the order. Please try again." }, { status: 500 });
  }
}
