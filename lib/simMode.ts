// Single source of truth for "pretend payments succeed" mode.
//
// Simulation mode skips webhook signature checks and exposes a public
// endpoint (/api/payment/simulate) that marks ANY order as paid, so it must
// NEVER be active on a live site. Two independent locks:
//
//   1. NODE_ENV must not be "production" (what `next start` / Vercel set).
//   2. The NODE_ENV check can't be trusted for custom servers (PM2,
//      `node server.js`, hosts that never set it) — but a REAL merchant key
//      (KHPAY_API_KEY, checked by shape: non-empty, not a placeholder word)
//      and pretend-payments never belong in the same environment, so the
//      presence of one disables simulation regardless of NODE_ENV.
//
// If you see the [security] warning below in your logs, remove
// PAYMENT_SIMULATION_MODE from that environment immediately.
let warnedDisabled = false;

function looksLikeRealKhpayKey(key: string | undefined): boolean {
  const v = (key ?? "").trim();
  if (!v) return false;
  // Real keys look like "ak_<48 hex chars>". Anything placeholder-shaped
  // ("your-key-here", "changeme", "xxx") doesn't count.
  if (/your|changeme|change-this|example|placeholder|xxx/i.test(v)) return false;
  return v.length >= 16;
}

/**
 * Demo mode: paiements ET livraison simulés.
 *
 * Turned on explicitly with DEMO_MODE="true". While it is on:
 *   * the checkout skips the payment gateway (same page as simulation), and
 *   * every order is DELIVERED instantly with obviously-fake content — a
 *     DEMO- gift-card code, a demo delivery note for top-ups — instead of
 *     calling the supplier, so you can walk the whole flow (cart → pay →
 *     order tracker → history → wallet) without spending anything.
 *
 * Unlike isSimulationMode() this deliberately works alongside a real
 * KHPAY_API_KEY, because it never contacts the gateway or the supplier.
 * The production lock still applies: NODE_ENV=production always turns it
 * off, so a live deployment can never hand out demo codes.
 */
export function isDemoMode(): boolean {
  if (process.env.DEMO_MODE !== "true") return false;
  if (process.env.NODE_ENV === "production") {
    if (!warnedDemoDisabled) {
      warnedDemoDisabled = true;
      console.error(
        "[security] DEMO_MODE=true is IGNORED because NODE_ENV=production. Remove DEMO_MODE from this environment."
      );
    }
    return false;
  }
  return true;
}

let warnedDemoDisabled = false;

export function isSimulationMode(): boolean {
  // Demo mode implies simulated payment — one switch for the whole flow.
  if (isDemoMode()) return true;

  const requested = process.env.PAYMENT_SIMULATION_MODE === "true";
  if (!requested) return false;

  const inProduction = process.env.NODE_ENV === "production";
  const hasRealKey = looksLikeRealKhpayKey(process.env.KHPAY_API_KEY);

  if (inProduction || hasRealKey) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.error(
        "[security] PAYMENT_SIMULATION_MODE=true is IGNORED because " +
          (inProduction
            ? "NODE_ENV=production"
            : "a real KHPAY_API_KEY is configured") +
          ". Remove PAYMENT_SIMULATION_MODE from this environment."
      );
    }
    return false;
  }
  return true;
}
