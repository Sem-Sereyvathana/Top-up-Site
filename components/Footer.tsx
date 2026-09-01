import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-fox-border/60 bg-fox-bg/80 text-fox-muted text-xs">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row justify-between items-start gap-8">
          
          {/* Brand Info */}
          <div className="max-w-xs space-y-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-fox-primary to-fox-accent text-white font-display font-bold text-sm">
                S
              </div>
              <span className="font-display font-extrabold text-base tracking-tight text-fox-text">
                SHARU<span className="text-fox-primary">TOPUP</span>
              </span>
            </Link>
            <p className="text-fox-muted leading-relaxed">
              Cambodia&apos;s fastest game top-up. Instant delivery, secure payment.
            </p>
          </div>

          {/* Support Column */}
          <div>
            <h4 className="font-display text-xs font-bold uppercase tracking-wider text-fox-text mb-3">
              Support
            </h4>
            <ul className="space-y-2">
              <li>Telegram: @sharutopup</li>
              <li>24/7 Service</li>
            </ul>
          </div>

        </div>

        {/* Bottom Bar */}
        <div className="mt-8 pt-6 border-t border-fox-border/40 flex flex-col sm:flex-row justify-between items-center gap-4 text-[11px] text-fox-muted">
          <p>© {new Date().getFullYear()} SHARUTOPUP. All rights reserved.</p>
          <p>Not affiliated with Moonton, Garena, Tencent or HoYoverse.</p>
        </div>
      </div>
    </footer>
  );
}