import { redirect } from "next/navigation";

// There's no separate "register" step anymore — connecting Telegram on
// /login creates the account automatically the first time. Keep this route
// so old links/bookmarks don't 404.
export default function RegisterPage() {
  redirect("/login");
}
