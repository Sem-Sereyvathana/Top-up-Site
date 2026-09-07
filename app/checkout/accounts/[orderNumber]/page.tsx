"use client";

import MarketplaceCheckout from "@/components/MarketplaceCheckout";
import { useShopCart, clearBuyNow, clearPendingOrder } from "@/lib/shopCart";

export default function AccountsCheckoutPage() {
  const { clear } = useShopCart();
  return (
    <MarketplaceCheckout
      apiBase="/api/game-account-orders"
      cancelHref="/accounts"
      orderTrackHref={(n) => `/order/accounts?number=${n}`}
      onPaid={() => {
        clear("accounts");
        clearBuyNow();
        clearPendingOrder("accounts");
      }}
      renderSummary={(order: any) => (
        <>
          <div className="flex justify-between text-sm">
            <span className="text-fox-muted">Accounts</span>
            <span className="text-right text-xs text-fox-muted space-y-0.5">
              {order.items.map((it: any, i: number) => (
                <div key={i}>{it.title}</div>
              ))}
            </span>
          </div>
          {order.deliveryMode === "MANUAL" && (
            <div className="mt-1 rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-3 text-xs text-yellow-200">
              This handover needs a quick chat — once paid, message us on Telegram with your order number to arrange it.
            </div>
          )}
        </>
      )}
    />
  );
}
