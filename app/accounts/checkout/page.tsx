"use client";

import ShopCheckout from "@/components/ShopCheckout";

export default function AccountsCheckoutPage() {
  return (
    <ShopCheckout
      kind="accounts"
      checkoutEndpoint="/api/game-account-orders"
      cartItemIdField="gameAccountId"
      requireUsername={false}
      backHref="/accounts"
      pageTitle="Checkout — Accounts"
      paymentPageHref={(n) => `/checkout/accounts/${n}`}
      collectContact={false}
    />
  );
}
