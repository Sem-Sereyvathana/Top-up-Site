"use client";

import MarketplaceOrderTracker from "@/components/MarketplaceOrderTracker";

export default function ItemsOrderTrackerPage() {
  return (
    <MarketplaceOrderTracker
      apiBase="/api/game-item-orders"
      autoRedirectManualPaid
      buildTelegramMessage={(order: any) => {
        const items = order.items
          .map((it: any) => `${it.name}${it.quantity > 1 ? ` x${it.quantity}` : ""}`)
          .join(", ");
        return `Hi! I just paid for order #${order.orderNumber} (${items}) — $${order.amountUsd.toFixed(
          2
        )}. My in-game username is ${order.buyerUsername}. Please help arrange delivery!`;
      }}
      renderDetails={(order: any) => (
        <>
          <div className="flex justify-between">
            <span className="text-fox-muted">Items</span>
            <span className="text-right text-xs font-medium space-y-0.5">
              {order.items.map((it: any, i: number) => (
                <div key={i}>
                  {it.name}
                  {it.quantity > 1 ? ` ×${it.quantity}` : ""}
                </div>
              ))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-fox-muted">Username</span>
            <span className="font-mono">{order.buyerUsername}</span>
          </div>
        </>
      )}
      renderPostPaidExtra={(order: any) =>
        order.status === "PAID" && order.deliveryMode === "DIRECT" ? (
          <div className="rounded-lg border border-blue-400/40 bg-blue-400/10 p-4 text-sm text-blue-300 flex items-center gap-2">
            Payment received — we'll deliver these into your account shortly.
          </div>
        ) : null
      }
    />
  );
}
