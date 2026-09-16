import ShopCartPage from "@/components/ShopCartPage";

export default function AccountsCartPage() {
  return (
    <ShopCartPage
      kind="accounts"
      title="Accounts Cart"
      backHref="/accounts"
      checkoutHref="/accounts/checkout"
      allowQuantity
    />
  );
}
