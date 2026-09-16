import ShopCartPage from "@/components/ShopCartPage";

export default function GameItemsCartPage() {
  return (
    <ShopCartPage
      kind="items"
      title="Game Items Cart"
      backHref="/game-items"
      checkoutHref="/game-items/checkout"
      allowQuantity
    />
  );
}
