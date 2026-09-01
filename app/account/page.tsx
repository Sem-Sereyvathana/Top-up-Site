"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { formatUsd } from "@/lib/utils";
import { Coins, Package, LogOut } from "lucide-react";

interface AccountOrder {
  id: string;
  orderNumber: string;
  status: string;
  amountUsd: number;
  pointsEarned: number;
  createdAt: string;
  game: { name: string };
  product: { name: string };
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "text-yellow-400 border-yellow-400/40 bg-yellow-400/10",
  PAID: "text-blue-400 border-blue-400/40 bg-blue-400/10",
  PROCESSING: "text-blue-400 border-blue-400/40 bg-blue-400/10",
  DELIVERED: "text-green-400 border-green-400/40 bg-green-400/10",
  FAILED: "text-red-400 border-red-400/40 bg-red-400/10",
  REFUNDED: "text-fox-muted border-fox-border bg-fox-card",
  CANCELLED: "text-fox-muted border-fox-border bg-fox-card",
};

export default function AccountPage() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login?next=/account");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    fetch("/api/account/orders")
      .then((r) => r.json())
      .then((data) => setOrders(data.orders ?? []))
      .catch(() => setOrders([]));
  }, [user]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  if (loading || !user) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center text-fox-muted">Loading…</main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">My Account</h1>
            <p className="text-sm text-fox-muted">{user.name || user.email || user.phone}</p>
          </div>
          <button
            onClick={handleLogout}
            className="btn-ghost text-sm flex items-center gap-2"
          >
            <LogOut className="h-4 w-4" strokeWidth={2.5} />
            Sign out
          </button>
        </div>

        <div className="card-glow p-6 border border-fox-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent text-black">
              <Coins className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-fox-muted">Loyalty Points</div>
              <div className="font-display text-2xl font-bold text-gradient">
                {user.points.toLocaleString()} pts
              </div>
            </div>
          </div>
          <div className="text-right text-sm text-fox-muted">
            ≈ {formatUsd(user.pointsValueUsd)}
            <div className="text-xs">Redeem {user.minRedeemPoints}+ pts at checkout</div>
          </div>
        </div>

        <div>
          <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
            <Package className="h-4 w-4" strokeWidth={2.5} />
            Order History
          </h2>

          {orders === null ? (
            <p className="text-sm text-fox-muted">Loading orders…</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-fox-muted">No orders yet — your future orders will show up here.</p>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <div key={o.id} className="card p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-fox-muted">{o.orderNumber}</div>
                    <div className="font-medium text-sm truncate">
                      {o.game.name} — {o.product.name}
                    </div>
                    <div className="text-xs text-fox-muted">
                      {new Date(o.createdAt).toLocaleDateString()}
                      {o.pointsEarned > 0 && <span className="text-fox-primary"> · +{o.pointsEarned} pts</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-sm">{formatUsd(o.amountUsd)}</div>
                    <span className={`inline-block mt-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLOR[o.status] || ""}`}>
                      {o.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
