import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { decrementStockForOrder } from "@/lib/stock";
import { finalizeOrderAfterPayment } from "@/lib/fulfillment";
import { handleGameItemOrderWebhook } from "@/lib/gameItemFulfillment";
import { handleGameAccountOrderWebhook } from "@/lib/gameAccountFulfillment";
import { NextRequest, NextResponse } from "next/server";

// Simulation: pretends payment succeeded and marks order PAID, then —
// unless it's a Roblox/Robux order, which needs manual delivery — DELIVERED.
// Only active when PAYMENT_SIMULATION_MODE=true or no real credentials set.
//
// Dispatches by order-number prefix exactly like the real KHPay webhook
// (app/api/payment/webhook/[method]/route.ts) — GI-/AC- orders go through
// their own marketplace handlers instead of the Top-up `Order` table below.
export async function GET(req: NextRequest) {
  if (process.env.PAYMENT_SIMULATION_MODE !== "true") {
    return NextResponse.json({ error: "Simulation is disabled" }, { status: 404 });
  }

  const orderNumber = req.nextUrl.searchParams.get("order");
  const ref = req.nextUrl.searchParams.get("ref") || `SIM-${Date.now()}`;

  if (!orderNumber) {
    return NextResponse.json({ error: "Missing order" }, { status: 400 });
  }

  const isPublicHttpUrl = (value?: string | null): value is string => {
    if (!value) return false;
    if (!/^https?:\/\//i.test(value)) return false;
    return !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(value);
  };
  const requestOrigin = req.nextUrl.origin;
  const envBase = process.env.NEXT_PUBLIC_BASE_URL;
  const baseUrl = (isPublicHttpUrl(envBase) ? envBase : requestOrigin).replace(/\/$/, "");

  const simulatedPage = (trackerPath: string) => `<!doctype html>
<html>
<head>
<title>Payment Simulated â€” RITHTOPUP</title>
<meta http-equiv="refresh" content="3;url=${baseUrl}${trackerPath}">
<style>
  body { font-family: system-ui; background: #0A0A0F; color: #F5F5F7; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; padding: 2rem; border: 1px solid #24243A; border-radius: 16px; background: #12121A; max-width: 400px; }
  h1 { color: #FF6B1A; margin: 0 0 1rem; }
  .check { font-size: 3rem; margin-bottom: 1rem; }
  code { background: #24243A; padding: 2px 8px; border-radius: 4px; color: #FFB800; }
  a { color: #FF6B1A; }
</style>
</head>
<body>
  <div class="box">
    <div class="check">âœ…</div>
    <h1>Payment Simulated</h1>
    <p>Order <code>${orderNumber}</code> is being processed.</p>
    <p style="color:#8B8B9E;font-size:0.875rem">Simulation mode is active â€” in production this would be your real ABA Pay or Binance Pay confirmation.</p>
    <p>Redirecting to order tracker in 3s...</p>
    <p><a href="${baseUrl}${trackerPath}">Continue now â†’</a></p>
  </div>
</body>
</html>`;

  if (orderNumber.startsWith("GI-")) {
    const order = await prisma.gameItemOrder.findUnique({ where: { orderNumber } });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    await handleGameItemOrderWebhook(orderNumber, "payment.paid", { amount: order.amountUsd }, ref);
    return new NextResponse(simulatedPage(`/order/items?number=${orderNumber}`), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (orderNumber.startsWith("AC-")) {
    const order = await prisma.gameAccountOrder.findUnique({ where: { orderNumber } });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    await handleGameAccountOrderWebhook(orderNumber, "payment.paid", { amount: order.amountUsd }, ref);
    return new NextResponse(simulatedPage(`/order/accounts?number=${orderNumber}`), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const order = await prisma.order.findUnique({ where: { orderNumber } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Mark as paid (and, for every game except Roblox/Robux, delivered)
  if (order.status === "PENDING") {
    // Robux/Roblox stays at PAID here — the admin delivers it manually from
    // the Robux Orders queue. Every other game is moved straight to
    // DELIVERED by finalizeOrderAfterPayment.
    await finalizeOrderAfterPayment(order.id, { paymentRef: ref });
    await decrementStockForOrder(order.id);
  }

  return new NextResponse(simulatedPage(`/order?number=${orderNumber}`), {
    headers: { "Content-Type": "text/html" },
  });
}
