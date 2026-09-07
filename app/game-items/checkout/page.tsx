"use client";

import ShopCheckout from "@/components/ShopCheckout";

export default function GameItemsCheckoutPage() {
  return (
    <ShopCheckout
      kind="items"
      checkoutEndpoint="/api/game-item-orders"
      cartItemIdField="gameItemId"
      cartListField="items"
      requireUsername
      usernameLabel="In-game Username"
      usernamePlaceholder="Your username in this game"
      backHref="/game-items"
      pageTitle="Checkout — Game Items"
      paymentPageHref={(n) => `/checkout/items/${n}`}
      collectContact={false}
    />
  );
}
