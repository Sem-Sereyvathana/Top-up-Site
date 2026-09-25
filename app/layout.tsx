import type { Metadata } from "next";
import "./globals.css";
import { prisma } from "@/lib/prisma";
import { CurrencyProvider } from "@/lib/currency";
import { ShopCartProvider } from "@/lib/shopCart";
import RouteProgress from "@/components/RouteProgress";
import AnnouncementBar from "@/components/AnnouncementBar";
import WelcomePopup from "@/components/WelcomePopup";
import SignInPopup from "@/components/SignInPopup";

export const metadata: Metadata = {
  title: "SHARUSTORE — Fast & Secure Game Top Up",
  description:
    "Top up Mobile Legends, Free Fire, PUBG, Genshin Impact and more. Instant delivery, secure KHQR payment. 24/7 service in Cambodia.",
  keywords: [
    "top up",
    "mobile legends diamonds",
    "free fire diamonds",
    "pubg uc",
    "genshin impact",
    "ABA Pay",
    "KHQR",
    "Cambodia top up",
  ],
  openGraph: {
    title: "SHARUSTORE — Fast & Secure Game Top Up",
    description: "Instant game top-ups with KHQR · ABA Pay · Wing · ACLEDA",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } }).catch(() => null);
  const exchangeRate = settings?.exchangeRate ?? 4100;

  return (
    <html lang="en">
      <body>
        <RouteProgress />
        <CurrencyProvider exchangeRate={exchangeRate}>
          <ShopCartProvider>
            <AnnouncementBar />
            <div className="site-shell flex min-h-screen flex-col">{children}</div>
            <WelcomePopup />
            <SignInPopup />
          </ShopCartProvider>
        </CurrencyProvider>
      </body>
    </html>
  );
}
