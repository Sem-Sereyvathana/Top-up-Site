"use client";

import ShopCheckout from "@/components/ShopCheckout";

export default function AccountsCheckoutPage() {
  return (
    <ShopCheckout
      kind="accounts"
      checkoutEndpoint="/api/game-account-orders"
      cartItemIdField="gameAccountId"
      cartListField="gameAccountIds"
      requireUsername={false}
      backHref="/accounts"
      pageTitle="Checkout — Accounts"
    />
  );
}
