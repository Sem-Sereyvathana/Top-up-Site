import GamePage from "@/app/games/[slug]/page";

export const dynamic = "force-dynamic";

// Clean URL (/robux-quick-login) for the Robux Quick Login game. It renders
// exactly the same page as /games/robux-quick-login — same username check,
// package cart and payment flow as Robux Send — so nothing is duplicated.
export default async function RobuxQuickLoginPage() {
  return GamePage({ params: Promise.resolve({ slug: "robux-quick-login" }) });
}
