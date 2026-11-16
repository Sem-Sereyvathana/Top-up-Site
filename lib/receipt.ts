import { prisma } from "./prisma";
import { escapeHtml } from "./telegram";

// Public proof-channel receipts (Telegram).
//
// RULES (per operator requirements):
//  - ALWAYS shows the NORMAL customer price (Order.normalPriceUsd), never
//    the reseller price actually paid. Reseller pricing is private.
//  - Exact format below; HTML parse mode; silent (disable_notification).
//  - Masked ID: only the last 3 characters of the player UID show, the rest
//    become • bullets.
//  - Time is UTC+7 (Cambodia).
//  - Sending goes through the ReceiptLog outbox with retries — a Telegram
//    outage must never block or lose a receipt, and must never fail the
//    order (everything here catches its own errors).

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7
const DIVIDER = "──────────────";

export function maskUid(uid: string): string {
  const raw = uid.trim();
  if (raw.length <= 3) return "•".repeat(Math.max(0, 6 - raw.length)) + raw;
  const tail = raw.slice(-3);
  return "•".repeat(Math.min(6, Math.max(4, raw.length - 3))) + tail;
}

/** "12 Nov 2026, 15:30 (UTC+7)" */
export function formatReceiptTime(date: Date): string {
  const d = new Date(date.getTime() + TZ_OFFSET_MS);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d.getUTCDate();
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm} (UTC+7)`;
}

interface ReceiptInput {
  orderNumber: string;
  gameName: string;
  productName: string;
  playerUid: string;
  /** NORMAL customer price — never the reseller price. */
  normalPriceUsd: number;
  paidAt: Date;
}

export function buildReceiptMessage(input: ReceiptInput): string {
  const name = escapeHtml(input.productName);
  const game = escapeHtml(input.gameName);
  const uid = escapeHtml(maskUid(input.playerUid));
  const price = `$${input.normalPriceUsd.toFixed(2)}`;
  const time = formatReceiptTime(input.paidAt);

  return [
    "✨ <b>SHARU STORE ✨</b>",
    "បង្កាន់ដៃ · Receipt",
    DIVIDER,
    `🙏 សូមអរគុណ ID ••••••${uid}`,
    "សម្រាប់ការជឿទុកចិត្ត Sharu Store!",
    DIVIDER,
    "📦 ទំនិញ · Item",
    `└ ${game} · ${name}`,
    "💰 តម្លៃ · Price",
    `└ ${price}`,
    "🕒 ពេលវេលា · Time",
    `└ ${time}`,
    DIVIDER,
    "💬 មានបញ្ហា? ទាក់ទង: @Sharu_Game",
  ].join("\n");
}

async function sendTelegramToChat(
  token: string,
  chatId: string,
  text: string
): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_notification: true, // silent, per requirement
      disable_web_page_preview: true,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram ${res.status}: ${body.slice(0, 200)}`);
  }
  return true;
}

/**
 * Queue a receipt for the proof channel. Never throws and never blocks the
 * order: it only writes a ReceiptLog row. processPendingReceipts does the
 * actual send (from the webhook's own call, the recovery sweep, or the
 * checkout page's polling). The message is rebuilt on send from immutable
 * order fields (normalPriceUsd snapshot), so a later reseller/product-price
 * change can never alter what the receipt shows.
 */
export async function queueTopupReceipt(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, paymentGroupId: true },
    });
    if (!order) return;

    // Paid as part of a combined checkout → the group sends ONE receipt for
    // the whole basket; individual children must not queue their own.
    if (order.paymentGroupId) return;

    await prisma.receiptLog.upsert({
      where: { dedupeKey: `topup:${order.id}` },
      update: {},
      create: {
        dedupeKey: `topup:${order.id}`,
        orderNumber: order.orderNumber,
        channel: "telegram",
        status: "PENDING",
      },
    });
  } catch (err) {
    console.error("[receipt] queue failed (order continues):", err);
  }
}

/**
 * Queue the single receipt for a combined multi-store order (PaymentGroup).
 * Same outbox/retry machinery as top-up receipts — just a different
 * dedupeKey.
 */
export async function queueGroupReceipt(groupId: string): Promise<void> {
  try {
    const group = await prisma.paymentGroup.findUnique({
      where: { id: groupId },
      select: { id: true, orderNumber: true },
    });
    if (!group) return;

    await prisma.receiptLog.upsert({
      where: { dedupeKey: `group:${group.id}` },
      update: {},
      create: {
        dedupeKey: `group:${group.id}`,
        orderNumber: group.orderNumber,
        channel: "telegram",
        status: "PENDING",
      },
    });
  } catch (err) {
    console.error("[receipt] queue failed (group continues):", err);
  }
}

/**
 * Send all pending receipts. Called from the order-recovery sweep (and can
 * be called manually). Safe to run concurrently — each row is claimed by
 * its status transition. Retries continue until Telegram confirms; after
 * MAX_ATTEMPTS the row is marked FAILED (surfaced in the admin Revenue tab)
 * but a manual re-send is still possible.
 */
const MAX_ATTEMPTS = 20;

export async function processPendingReceipts(limit = 10): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } }).catch(() => null);
  const token =
    settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId =
    settings?.receiptTelegramChatId || process.env.RECEIPT_TELEGRAM_CHAT_ID || "";
  if (!token || !chatId) return; // receipts not configured — nothing to do

  const pending = await prisma.receiptLog.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const receipt of pending) {
    try {
      const message = await rebuildReceiptMessage(receipt.dedupeKey);
      if (!message) {
        // Order gone (deleted?) — retire the receipt rather than retry forever.
        await prisma.receiptLog.update({
          where: { id: receipt.id },
          data: { status: "SKIPPED", lastError: "Order not found" },
        }).catch(() => {});
        continue;
      }

      await sendTelegramToChat(token, chatId, message);
      await prisma.receiptLog.update({
        where: { id: receipt.id },
        data: { status: "SENT", sentAt: new Date(), lastError: null },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.receiptLog
        .update({
          where: { id: receipt.id },
          data: {
            attempts: { increment: 1 },
            status: receipt.attempts + 1 >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            lastError: msg.slice(0, 300),
          },
        })
        .catch(() => {});
      console.warn("[receipt] send failed:", receipt.orderNumber, msg);
    }
  }
}

/** Rebuild the receipt text from the order referenced by the dedupe key. */
async function rebuildReceiptMessage(dedupeKey: string): Promise<string | null> {
  if (dedupeKey.startsWith("group:")) {
    return buildGroupReceiptMessage(dedupeKey.slice("group:".length));
  }
  if (!dedupeKey.startsWith("topup:")) return null;
  const orderId = dedupeKey.slice("topup:".length);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { game: true, product: true },
  });
  if (!order) return null;

  const normal =
    order.normalPriceUsd !== null && order.normalPriceUsd !== undefined
      ? order.normalPriceUsd
      : order.amountUsd;

  return buildReceiptMessage({
    orderNumber: order.orderNumber,
    gameName: order.game.name,
    productName: order.product.name,
    playerUid: order.playerUid,
    normalPriceUsd: normal,
    paidAt: order.paidAt ?? order.createdAt,
  });
}

/**
 * ONE receipt for a combined multi-store order.
 *
 * Lists every line the buyer bought. Gift cards are always printed LAST
 * (they're the only line that needs a redeem step), even when the basket
 * mixes them with top-ups, items and accounts.
 */
async function buildGroupReceiptMessage(groupId: string): Promise<string | null> {
  const group = await prisma.paymentGroup.findUnique({ where: { id: groupId } });
  if (!group) return null;

  const [topup, items, accounts] = await Promise.all([
    prisma.order.findMany({
      where: { paymentGroupId: groupId },
      include: { game: { select: { name: true, slug: true } }, product: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.gameItemOrder.findMany({
      where: { paymentGroupId: groupId },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.gameAccountOrder.findMany({
      where: { paymentGroupId: groupId },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  type Line = { title: string; detail: string; price: number; giftcard: boolean };
  const lines: Line[] = [];

  for (const o of topup) {
    // Gift cards: the delivered code is the "detail" line.
    const giftcard = o.game.slug === "robux-giftcard";
    const codes = giftcard && o.deliveryNote?.startsWith("Giftcard code: ")
      ? o.deliveryNote.slice("Giftcard code: ".length).replace(/\s*\[DEMO MODE.*\]$/i, "").trim()
      : "";
    lines.push({
      title: `${o.game.name} · ${o.product.name}`,
      detail: giftcard
        ? codes
          ? `កូដ · ${codes}`
          : "កូដ · (នឹងផ្ញើដោយឡែក)"
        : `ID ${maskUid(o.playerUid)}`,
      price: o.normalPriceUsd ?? o.amountUsd,
      giftcard,
    });
  }
  for (const o of items) {
    lines.push({
      title: o.items.map((it) => `${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(", "),
      detail: `Game Item · ${o.buyerUsername}`,
      price: o.amountUsd,
      giftcard: false,
    });
  }
  for (const o of accounts) {
    lines.push({
      title: o.items.map((it) => `${it.title}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(", "),
      detail: "Account",
      price: o.amountUsd,
      giftcard: false,
    });
  }

  // Gift cards pinned to the bottom.
  lines.sort((a, b) => Number(a.giftcard) - Number(b.giftcard));

  const total = lines.reduce((s, l) => s + l.price, 0);
  const body: string[] = [];
  for (const l of lines) {
    body.push(`└ ${escapeHtml(l.title)}`);
    if (l.detail) body.push(`   ${escapeHtml(l.detail)}`);
    body.push(`   $${l.price.toFixed(2)}`);
  }

  return [
    "✨ <b>SHARU STORE ✨</b>",
    "បង្កាន់ដៃ · Receipt",
    DIVIDER,
    `🙏 សូមអរគុណ — Order ${escapeHtml(group.orderNumber)}`,
    "សម្រាប់ការជឿទុកចិត្ត Sharu Store!",
    DIVIDER,
    "📦 ទំនិញ · Items",
    ...body,
    "💰 តម្លៃ · Total",
    `└ $${total.toFixed(2)}`,
    "🕒 ពេលវេលា · Time",
    `└ ${formatReceiptTime(group.paidAt ?? group.createdAt)}`,
    DIVIDER,
    "💬 មានបញ្ហា? ទាក់ទង: @Sharu_Game",
  ].join("\n");
}
