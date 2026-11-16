import ShopCartPage from "@/components/ShopCartPage";

export default function GameItemsCartPage() {
  return (
    <ShopCartPage
      kind="items"
      title="ទំនិញដែលអ្នកបានជ្រើសរើស"
      backHref="/game-items"
      allowQuantity
    />
  );
}
