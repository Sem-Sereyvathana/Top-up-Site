"use client";

import MarketplaceCheckout, { Row } from "@/components/MarketplaceCheckout";
import { useShopCart, clearPendingOrder } from "@/lib/shopCart";

export default function ItemsCheckoutPage() {
  const { clear } = useShopCart();
  return (
    <MarketplaceCheckout
      apiBase="/api/game-item-orders"
      cancelHref="/game-items"
      orderTrackHref={(n) => `/order/items?number=${n}`}
      onPaid={() => {
        clear("items");
        clearPendingOrder("items");
      }}
      renderSummary={(order: any) => (
        <>
          <Row label="Username">
            <span className="font-mono">{order.buyerUsername}</span>
          </Row>
          <div className="flex justify-between text-sm">
            <span className="text-fox-muted">Items</span>
            <span className="text-right text-xs text-fox-muted space-y-0.5">
              {order.items.map((it: any, i: number) => (
                <div key={i}>
                  {it.name}
                  {it.quantity > 1 ? ` ×${it.quantity}` : ""}
                </div>
              ))}
            </span>
          </div>
          {order.deliveryMode === "MANUAL" && (
            <div className="mt-1 rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-3 text-xs text-yellow-200">
              This order needs a quick chat to arrange delivery — once paid, you&apos;ll be taken straight to our Telegram with your order details ready to send.
            </div>
          )}
        </>
      )}
    />
  );
}
