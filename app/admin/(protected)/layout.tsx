import Link from "next/link";
import { getCurrentAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getCurrentAdmin();

  // This layout only wraps pages under app/admin/(protected)/ — the login
  // page lives at app/admin/login/ (a sibling, outside this route group),
  // so it's never subject to this check and there's no risk of a redirect
  // loop. Belt-and-braces alongside the middleware: if there's ever a gap
  // in the middleware matcher, this still stops the page itself from
  // rendering for a signed-out visitor.
  if (!admin) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r border-fox-border bg-fox-surface flex flex-col">
        <Link href="/admin" className="p-6 border-b border-fox-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-fox-primary to-fox-accent flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-black">
                <path d="M12 2L3 7v6c0 5 3.5 9 9 10 5.5-1 9-5 9-10V7l-9-5z" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <div>
              <div className="font-display font-bold text-sm">
                SHARU<span className="text-fox-primary">STORE</span>
              </div>
              <div className="text-[10px] text-fox-muted uppercase tracking-widest">
                Admin Panel
              </div>
            </div>
          </div>
        </Link>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {[
            { href: "/admin", label: "Dashboard", icon: "📊" },
            { href: "/admin/orders", label: "Orders", icon: "📦" },
            { href: "/admin/robux-orders", label: "Robux Orders", icon: "🪙" },
            { href: "/admin/games", label: "Games", icon: "🎮" },
            { href: "/admin/products", label: "Products", icon: "💎" },
            { href: "/admin/robux-stock", label: "Robux Stock", icon: "🪙" },
            { href: "/admin/game-items", label: "Game Items", icon: "🎁" },
            { href: "/admin/game-item-orders", label: "Item Orders", icon: "📮" },
            { href: "/admin/accounts", label: "Accounts", icon: "🕹️" },
            { href: "/admin/account-orders", label: "Account Orders", icon: "🔑" },
            { href: "/admin/promo-codes", label: "Promo Codes", icon: "🏷️" },
            { href: "/admin/banners", label: "Banners", icon: "🖼️" },
            { href: "/admin/blog", label: "Blog", icon: "📝" },
            { href: "/admin/customers", label: "Customers", icon: "👥" },
            { href: "/admin/banlist", label: "Banlist", icon: "🚫" },
            { href: "/admin/audit-logs", label: "Audit Log", icon: "📜" },
            { href: "/admin/settings", label: "Settings", icon: "⚙️" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fox-text/80 hover:bg-fox-card hover:text-fox-primary transition-colors"
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-fox-border">
          <div className="text-xs text-fox-muted mb-1">Signed in as</div>
          <div className="text-sm font-medium mb-3 truncate">{admin.email}</div>
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
