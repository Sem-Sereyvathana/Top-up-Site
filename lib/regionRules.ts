// Pre-purchase region gate for top-ups.
//
// Why this exists: FazerCards only reveals an account's region AFTER charging.
// If the pack doesn't match, the order comes back "Refund — this pack is not
// available for your account's region": the supplier refunds OUR balance, but
// the customer has already paid us and their money has to be refunded by hand.
// Checking the region up front means they find out BEFORE paying.
//
// How: FazerCards' /topups/validate-id returns the account's region on a
// SUCCESSFUL check, e.g.
//   {"valid":true,"player_name":"Naz16!","region":"SG"}
//   {"valid":true,"player_name":"Ing Sunghoon","region":"Cambodia"}
//
// IMPORTANT — `region` is the account's SERVER GROUP, not a country name.
// Verified: an account the owner knows is Malaysian comes back as "SG",
// because Free Fire MY and SG are one group.
//
// 1) BLOCKLIST (`blockedRegions`) — the pack serves EVERY region except the
//    ones with their own dedicated pack on FazerCards. This is how both
//    Mobile Legends (Global) and Free Fire (MY/SG) work: the panel sells
//    packs per region, and the pack this store sells is the catch-all for
//    regions that don't have their own. Cambodia is the verified case for
//    both — it has no FF/ML pack of its own, so it buys from Global (ML) or
//    MY/SG (Free Fire). A region that DOES have its own pack (VN, TH, ID,
//    PH, BR, etc.) must buy that one instead, so we block it here — every
//    other unlisted region is allowed.
//
// 2) ALLOWLIST (`allowedRegions`) — only when a page is known to accept
//    exactly a short list and no blocklist mapping exists yet.
//
// Fails OPEN by design:
//   * no rule for the game                 -> not gated
//   * checker unavailable/timed out        -> not gated (an outage must never
//                                             stop real sales)
//   * region missing from the reply        -> not gated
//   * region present AND gated against it  -> BLOCKED (the only blocking case)
//
// To extend: add a blocklist rule for each new region-aware game page and
// list the exact strings FazerCards returns for each blocked region.

export interface RegionRule {
  /**
   * Allowlist mode: the ONLY server-group strings this pack can serve.
   * Mutually exclusive with `blockedRegions`.
   */
  allowedRegions?: string[];
  /**
   * Blocklist mode: server-group strings this pack can NOT serve (they have
   * their own dedicated pack). Every other region is allowed.
   */
  blockedRegions?: string[];
  /** Shown to the buyer in the "wrong region" message. */
  label: string;
}

// Regions FazerCards sells their own Mobile Legends pack for, so the Global
// pack must not be used for them. Kept as one list so the Global rule and the
// buyer-facing message stay in sync.
//
// NOTE on the strings: FazerCards returns display names for some games
// ("Cambodia", "Indonesia") and 2-letter codes for others ("SG", "MY").
// Comparison is case-insensitive and trimmed, so list the exact strings you
// have seen the checker return for each region. "United States" is listed
// under the name the panel uses; if the checker ever returns "US" for an
// American account, add that too.
const ML_OWN_REGIONS = [
  "RU",
  "Russia",
  "Philippines",
  "PH",
  "Brazil",
  "BR",
  "Indonesia",
  "ID",
  "Malaysia",
  "MY",
  "Singapore",
  "SG",
  "Turkey",
  "TR",
  "United States",
  "US",
];

// Regions FazerCards sells their own Free Fire pack for, so the MY/SG pack
// must not be used for them. Same reasoning as ML_OWN_REGIONS: a region with a
// dedicated pack has to buy that one, and using MY/SG would come back as a
// refund AFTER we've charged the customer.
//
// From the reseller panel: CIS, MENA, LATAM, BD, BR, EU, ID, MY/SG, PH, SG,
// TH, TW, VN. The MY/SG pack is what this store sells, so both MY and SG
// accounts are ALLOWED (that is the pack's own server group) — do NOT list
// them as blocked. The other groups have dedicated packs and are blocked.
// Cambodia is served by MY/SG (the country has no FF pack of its own), which
// is the verified case this store was built around.
const FF_OWN_REGIONS = [
  "CIS",
  "MENA",
  "LATAM",
  "Bangladesh",
  "BD",
  "Brazil",
  "BR",
  "Europe",
  "EU",
  "Indonesia",
  "ID",
  "Philippines",
  "PH",
  "Thailand",
  "TH",
  "Taiwan",
  "TW",
  "Vietnam",
  "VN",
];

const RULES: Record<string, RegionRule> = {
  // Mobile Legends (Global) — the catch-all pack. Serves every region
  // EXCEPT the ones with their own dedicated ML pack on FazerCards (see
  // ML_OWN_REGIONS). Cambodia is served by Global (verified with a real
  // account), and so are Vietnam, Thailand, Laos, Myanmar and every other
  // region without a dedicated pack.
  "mobile-legends-kh": {
    blockedRegions: ML_OWN_REGIONS,
    label: "Mobile Legends (Global)",
  },

  // Free Fire (MY/SG) — this store sells FazerCards' MY/SG pack, which also
  // serves Cambodian accounts (their server group). Blocklist, same as ML:
  // regions with their own dedicated FF pack (VN, TH, ID, PH, BR, BD, TW,
  // SG, CIS, MENA, LATAM, EU) must buy that pack instead. Everything left
  // over — Cambodia above all — is served here.
  "free-fire-kh": {
    blockedRegions: FF_OWN_REGIONS,
    label: "Free Fire (MY/SG)",
  },

  // Valorant / EA FC: no public account check exists, so there is nothing
  // to compare. They rely on the wallet-refund safety net instead — see
  // the region-mismatch handling in lib/fulfillment.ts.
};

/** null → no region gate for this game (buyer may proceed). */
export function regionRuleFor(gameSlug: string): RegionRule | null {
  return RULES[gameSlug] ?? null;
}

/**
 * Does an account region satisfy the rule?
 *   null  -> nothing to compare (no rule, or region unknown) => do NOT block
 *   true  -> allowed
 *   false -> definite mismatch => block
 *
 * Allowlist rules block anything not in `allowedRegions`; blocklist rules
 * block only the regions in `blockedRegions`. Comparison is trimmed and
 * case-insensitive because FazerCards returns display strings
 * ("Cambodia", "SG").
 */
export function regionAllowed(
  rule: RegionRule | null,
  region: string | null | undefined
): boolean | null {
  if (!rule) return null;
  const got = (region ?? "").trim().toLowerCase();
  if (!got) return null;

  if (rule.blockedRegions) {
    const blocked = rule.blockedRegions.some(
      (r) => r.trim().toLowerCase() === got
    );
    return blocked ? false : true;
  }

  const allowed = rule.allowedRegions ?? [];
  return allowed.some((r) => r.trim().toLowerCase() === got);
}

/**
 * Human-readable description of who the pack IS for, used in the
 * buyer-facing "wrong region" message.
 *   allowlist -> "Cambodia, MY, SG"
 *   blocklist -> "every region except RU, Philippines, …"
 */
export function regionScopeDescription(rule: RegionRule): string {
  if (rule.blockedRegions && rule.blockedRegions.length > 0) {
    return `every region except ${rule.blockedRegions.join(", ")}`;
  }
  return (rule.allowedRegions ?? []).join(", ");
}
