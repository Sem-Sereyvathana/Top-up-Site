import ShopCartPage from "@/components/ShopCartPage";

export default function AccountsCartPage() {
  return (
    <ShopCartPage
      kind="accounts"
      title="ទំនិញដែលអ្នកបានជ្រើសរើស"
      backHref="/accounts"
      checkoutHref="/accounts/checkout"
      allowQuantity
    />
  );
}
