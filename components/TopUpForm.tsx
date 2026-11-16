"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  isValidUid,
  formatUsd,
  isRobuxGame,
  isGiftcardGame,
  isQuickLoginGame,
} from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import DualPrice from "@/components/DualPrice";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { getGameIdConfig } from "@/lib/gameIdConfig";
import { requireLogin, isLoginRequired, GOOGLE_LOGIN_REQUIRED } from "@/lib/loginGate";
import { saveDraft, loadDraft, clearDraft } from "@/lib/formDraft";
import {
  ArrowRight,
  Lock,
  Check,
  UserRoundCheck,
  AlertCircle,
  Tag,
  Loader2,
  Coins,
  Plus,
  Minus,
  Star,
  X,
} from "lucide-react";
import RobuxStockBadge from "@/components/RobuxStockBadge";

// Which games have a nickname check / a separate Zone ID box lives in
// lib/gameIdConfig.ts (one entry per game).

interface Product {
  id: string;
  name: string;
  amount: number;
  bonus: number;
  priceUsd: number;
  badge: string | null;
  imageUrl?: string | null;
  stock?: number | null;
  // "First Top-Up Bonus" pack: only pays double on an account's very first
  // recharge. Selecting one confirms with the buyer before continuing.
  isFirstTopUp?: boolean;
}

interface Game {
  id: string;
  slug: string;
  name: string;
  currencyName: string;
  uidLabel: string;
  uidExample: string | null;
}

function isOutOfStock(product: Product): boolean {
  return (
    product.stock !== null &&
    product.stock !== undefined &&
    product.stock <= 0
  );
}

function requiredRobux(product: Product): number {
  return Math.max(0, product.amount);
}

// ── Package display ─────────────────────────────────────────────────────
// The customer sees ONE number per pack. FazerCards names packs by their
// split ("78 + 8 Diamonds", "1860 + 335 Diamonds"), which reads like a
// formula and clutters the tile, so:
//
//   * First Top-Up Bonus pack  -> "50 + 50 Diamonds" (the doubling IS the
//                                 selling point, so it stays visible)
//   * Any other pack           -> "86 Diamonds" (amount + bonus summed)
//   * Pass / bundle            -> no amount line at all (Weekly Pass has no
//                                 diamond count; showing "0 Diamonds" is
//                                 meaningless)
//
// The name is shown underneath only when it adds information. If the name
// is just the pack's own amount ("78 + 8 Diamonds"), it is suppressed —
// otherwise the tile would read "86 Diamonds / 78 + 8 Diamonds".
function totalAmount(product: Product): number {
  return Math.max(0, product.amount) + Math.max(0, product.bonus);
}

function isFirstTopUpPack(product: Product): boolean {
  return !!product.isFirstTopUp && product.amount > 0;
}

/** "50 + 50 Diamonds" for first-top-up packs, "86 Diamonds", or "" for passes. */
function amountLabel(product: Product, currency: string): string {
  const base = Math.max(0, product.amount);
  if (isFirstTopUpPack(product)) {
    return `${base.toLocaleString()} + ${base.toLocaleString()} ${currency}`;
  }
  const total = totalAmount(product);
  return total > 0 ? `${total.toLocaleString()} ${currency}` : "";
}

/**
 * The product name to show under the amount, or "" when it is redundant.
 * Dropped when the name is only the pack's own amount, optionally with a
 * trailing note — the number line above already says it:
 *   "86 Diamonds"                                  -> ""
 *   "475 VP" / "100 Diamonds"                      -> ""
 *   "50 + 50 Diamonds (First Top-Up Bonus)"        -> "" (badge says FIRST TOP UP)
 * Real labels ("Weekly Pass", "First Recharge 100 (50 + 50 Bonus)") stay.
 */
function displayName(product: Product): string {
  const name = product.name.trim();

  // "<amount> [+ <amount>] <currency>" with an optional trailing "( ... )".
  const bareAmount =
    /^[\d,\s]+(?:\+\s*[\d,\s]+)?\s*(diamonds?|vp|robux|silver|fc\s*points|points)?\s*(\([^)]*\))?$/i;

  if (bareAmount.test(name)) return "";
  return name;
}

function isRobuxProductAvailable(
  product: Product,
  robuxStock: number | null
): boolean {
  if (isOutOfStock(product)) return false;

  if (robuxStock === null || robuxStock === undefined) {
    return true;
  }

  return (
    product.amount <= 0 ||
    robuxStock >= requiredRobux(product)
  );
}

export default function TopUpForm({
  game,
  products,
  robuxStock = null,
}: {
  game: Game;
  products: Product[];
  robuxStock?: number | null;
}) {
  const { format } = useCurrency();
  const { user } = useCurrentUser();

  const robuxGame = isRobuxGame(game);
  // Gift card packs need no account ID at all (see lib/utils.ts).
  const giftcardGame = isGiftcardGame(game);
  // Games with the multi-package cart (pick several packs, per-pack quantity
  // controls): the Roblox-style Robux games AND the Robux Giftcard page.
  // The orders API accepts an `items` cart for exactly the same set, so the
  // client and server can't drift apart.
  const cartMode = robuxGame || giftcardGame;
  // Packages with an admin-set badge (Hot, Best Selling, ...) are also
  // shown in a compact "Popular" section above the full list. Cart games
  // are excluded because their cards have quantity controls.
  const popularProducts = cartMode
    ? []
    : products.filter((p) => !!p.badge?.trim());

  // Compact package tile used by the Popular section (large) and the
  // All Packages grid (compact) on every non-Roblox game.
  const renderTile = (
    product: Product,
    size: "large" | "compact",
    keyPrefix: string
  ) => {
    const large = size === "large";
    const unavailable = isOutOfStock(product);
    const isSelected = selected === product.id;
    const hasBadge = !!product.badge?.trim();

    return (
      <button
        key={`${keyPrefix}-${product.id}`}
        type="button"
        disabled={unavailable}
        onClick={() => pickProduct(product)}
        className={`card relative overflow-hidden text-left transition-all ${
          large ? "p-4" : "p-3"
        } ${hasBadge ? (large ? "pb-11" : "pb-9") : ""} ${
          isSelected
            ? "border-fox-primary ring-1 ring-fox-primary/50"
            : "hover:border-fox-primary/40"
        } ${unavailable ? "opacity-40 cursor-not-allowed" : ""}`}
      >
        {isSelected && (
          <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-fox-primary text-black">
            <Check className="h-3 w-3" />
          </div>
        )}

        <div className={`flex items-center ${large ? "gap-4" : "gap-3"}`}>
          {product.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className={`shrink-0 rounded-lg object-cover ${
                large ? "h-16 w-16" : "h-14 w-14"
              }`}
            />
          )}
          <div className="min-w-0">
            <div
              className={`font-display font-bold leading-tight ${
                large ? "text-lg" : "text-base"
              }`}
            >
              <DualPrice usd={product.priceUsd} stacked />
            </div>
            {amountLabel(product, game.currencyName) ? (
              <div
                className={`font-display font-bold mt-1 ${
                  large ? "text-sm" : "text-xs"
                }`}
              >
                {amountLabel(product, game.currencyName)}
              </div>
            ) : null}
            {displayName(product) ? (
              <div
                className={`mt-1 truncate text-fox-muted ${
                  large ? "text-sm" : "text-xs"
                }`}
              >
                {displayName(product)}
              </div>
            ) : null}
          </div>
        </div>

        {hasBadge && (
          <span
            className={`absolute bottom-0 left-0 rounded-tr-lg bg-gradient-to-r from-fox-primary to-fox-accent font-bold uppercase italic text-black ${
              large ? "px-3 py-1.5 text-xs" : "px-2.5 py-1 text-[10px]"
            }`}
          >
            {product.badge}
          </span>
        )}

        {unavailable && (
          <span className="absolute bottom-1 right-2 text-[10px] text-red-400">
            អស់ហើយ
          </span>
        )}
      </button>
    );
  };

  const idConfig = getGameIdConfig(game.slug);
  const supportsLookup = !!idConfig;
  const useZoneField = !!idConfig?.needsServer;

  const [currentRobuxStock] =
    useState<number | null>(robuxStock);

  // Normal games use one selected package
  const [selected, setSelected] =
    useState<string | null>(null);

  // First Top-Up Bonus confirmation: clicking a first-top-up pack opens a
  // dialog asking whether this account has NEVER topped up this package
  // before. Confirm -> select it; Go back -> nothing selected. The popup
  // re-appears on re-click so there is always an explicit confirmation.
  const [firstTopUpCandidate, setFirstTopUpCandidate] =
    useState<Product | null>(null);

  // Pick a package. First Top-Up Bonus packs go through the confirmation
  // dialog instead of selecting immediately.
  const pickProduct = useCallback((product: Product) => {
    if (product.isFirstTopUp) {
      setFirstTopUpCandidate(product);
    } else {
      setSelected(product.id);
    }
  }, []);

  // Roblox uses multiple packages
  // IMPORTANT: starts EMPTY — no automatic package
  const [cart, setCart] = useState<Record<string, number>>(
    {}
  );

  const [uid, setUid] = useState("");

  const [serverId, setServerId] = useState("");

  // Key for the "keep what they typed through Google sign-in" draft — see
  // handleSubmit (which writes it via lib/loginGate + lib/formDraft) and
  // the restore effect below.
  const draftKey = `sharustore_topup_draft_${game.slug}`;
  const restoredFromDraftRef = useRef(false);

  const [method] =
    useState<"KHPAY">("KHPAY");

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  // Promo
  const [promoInput, setPromoInput] =
    useState("");

  const [promoApplied, setPromoApplied] =
    useState<{
      code: string;
      discountUsd: number;
      finalAmountUsd: number;
      discountType: string;
      discountValue: number;
      // Set by the server when the coupon is tied to one exact package.
      // The storefront re-checks this if the shopper changes package.
      applicableProductId?: string | null;
      applicableProductName?: string | null;
    } | null>(null);

  const [promoLoading, setPromoLoading] =
    useState(false);

  const [promoError, setPromoError] =
    useState<string | null>(null);

  // Loyalty points
  const [usePoints, setUsePoints] =
    useState(false);

  const canRedeemPoints =
    !!user &&
    user.points >= user.minRedeemPoints;

  // Pay from wallet balance instead of the KHQR. Only offered when signed
  // in with enough balance to cover the whole order (no partial payments).
  const [payWithWallet, setPayWithWallet] = useState(false);
  const walletUsd = user?.walletUsd ?? 0;

  // Nickname lookup
  type NicknameStatus =
    | "idle"
    | "checking"
    | "verified"
    | "not_found" // the service says this ID doesn't exist
    | "unavailable" // the service failed — can't tell
    | "unsupported"; // no lookup set up for this game yet

  const [nicknameStatus, setNicknameStatus] =
    useState<NicknameStatus>("idle");

  const [nickname, setNickname] =
    useState<string | null>(null);

  // Region verdict from the account check. `allowed === false` means this
  // account's region can't be served by the packs on this page — checkout is
  // blocked (the orders API enforces the same rule).
  const [regionVerdict, setRegionVerdict] = useState<{
    region: string | null;
    allowed: boolean | null;
    label: string | null;
    allowedRegions: string[] | null;
  }>({ region: null, allowed: null, label: null, allowedRegions: null });

  const clearRegionVerdict = () =>
    setRegionVerdict({ region: null, allowed: null, label: null, allowedRegions: null });

  const debounceRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

  const abortRef =
    useRef<AbortController | null>(null);

  // Roblox verification
  const [robloxChecking, setRobloxChecking] =
    useState(false);

  const [robloxAccount, setRobloxAccount] =
    useState<{
      id: number;
      name: string;
      displayName: string;
      avatarUrl: string;
    } | null>(null);

  const [robloxError, setRobloxError] =
    useState<string | null>(null);

  const resetLookup = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }

    setNicknameStatus("idle");
    setNickname(null);
    // A verdict only describes the ID it was checked for — drop it whenever
    // the buyer edits the ID/zone, so a stale answer can never block (or
    // wrongly allow) a different account.
    clearRegionVerdict();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs the nickname lookup right now. Used by the debounced auto-check
  // below and by the "Check User ID" button.
  const runLookup = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    setNicknameStatus("checking");
    setNickname(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/lookup-uid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameSlug: game.slug,
          uid: uid.trim(),
          server: serverId.trim() || undefined,
        }),
        signal: controller.signal,
      });

      const data = await res.json();

      if (controller.signal.aborted) return;

      // Region verdict — null when this game isn't gated or the region is
      // unknown. Only an explicit false blocks checkout.
      setRegionVerdict({
        region: typeof data.region === "string" ? data.region : null,
        allowed: typeof data.regionAllowed === "boolean" ? data.regionAllowed : null,
        label: typeof data.regionLabel === "string" ? data.regionLabel : null,
        allowedRegions: Array.isArray(data.allowedRegions) ? data.allowedRegions : null,
      });

      const status: string =
        data.status ??
        (data.verified && data.nickname ? "verified" : "unavailable");

      if (status === "verified" && data.nickname) {
        setNickname(data.nickname);
        setNicknameStatus("verified");
      } else if (status === "not_found") {
        setNicknameStatus("not_found");
      } else if (status === "unsupported") {
        setNicknameStatus("unsupported");
      } else {
        setNicknameStatus("unavailable");
      }
    } catch {
      if (!controller.signal.aborted) {
        setNicknameStatus("unavailable");
      }
    }
  }, [uid, serverId, game.slug]);

  // Nickname lookup (auto, after the person stops typing)
  useEffect(() => {
    if (!supportsLookup) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }

    const uidValid = isValidUid(uid);

    const serverValid =
      !useZoneField ||
      serverId.trim().length > 0;

    if (!uidValid || !serverValid) {
      setNicknameStatus("idle");
      setNickname(null);
      return;
    }

    debounceRef.current = setTimeout(runLookup, 800);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [
    uid,
    serverId,
    game.slug,
    supportsLookup,
    useZoneField,
    runLookup,
  ]);

  const selectedProduct =
    products.find(
      (product) => product.id === selected
    );

  // Cart lines
  const cartLines = Object.entries(cart)
    .map(([id, quantity]) => ({
      product: products.find(
        (product) => product.id === id
      ),
      quantity,
    }))
    .filter(
      (
        line
      ): line is {
        product: Product;
        quantity: number;
      } =>
        !!line.product &&
        line.quantity > 0
    );

  const cartSubtotal = cartLines.reduce(
    (sum, line) =>
      sum +
      line.product.priceUsd *
        line.quantity,
    0
  );

  const cartRobuxTotal = cartLines.reduce(
    (sum, line) =>
      sum +
      Math.max(
        0,
        line.product.amount
      ) *
        line.quantity,
    0
  );

  const cartExceedsStock =
    robuxGame &&
    currentRobuxStock !== null &&
    cartRobuxTotal > currentRobuxStock;

  // Cart functions
  function toggleCartCard(productId: string) {
    setCart((previous) => {
      if (previous[productId]) {
        const next = { ...previous };
        delete next[productId];
        return next;
      }

      return {
        ...previous,
        [productId]: 1,
      };
    });
  }

  function changeQty(
    productId: string,
    delta: number
  ) {
    setCart((previous) => {
      const current =
        previous[productId] ?? 0;

      const nextQty =
        current + delta;

      if (nextQty <= 0) {
        const next = { ...previous };
        delete next[productId];
        return next;
      }

      return {
        ...previous,
        [productId]: Math.min(
          nextQty,
          20
        ),
      };
    });
  }

  // Remove unavailable Roblox products if stock changes
  useEffect(() => {
    if (
      !robuxGame ||
      currentRobuxStock === null
    ) {
      return;
    }

    setCart((previous) => {
      const next: Record<string, number> =
        {};

      let changed = false;

      for (const [id, quantity] of Object.entries(
        previous
      )) {
        const product = products.find(
          (item) => item.id === id
        );

        if (
          product &&
          isRobuxProductAvailable(
            product,
            currentRobuxStock
          )
        ) {
          next[id] = quantity;
        } else {
          changed = true;
        }
      }

      return changed
        ? next
        : previous;
    });
  }, [
    currentRobuxStock,
    products,
    robuxGame,
  ]);

  const needsServer =
    !robuxGame && useZoneField;

  const packageReady = cartMode
    ? cartLines.length > 0 &&
      !cartExceedsStock
    : !!selectedProduct &&
      !isOutOfStock(selectedProduct);

  const robloxAvatarConfirmed =
    !robuxGame ||
    !!robloxAccount;

  // The region gate: true only when the checker returned a definite
  // mismatch. An unknown region (null) never blocks — see lib/regionRules.ts.
  const regionBlocked = regionVerdict.allowed === false;

  const canSubmit =
    packageReady &&
    (giftcardGame || isValidUid(uid)) &&
    robloxAvatarConfirmed &&
    !regionBlocked &&
    (
      !needsServer ||
      serverId.trim().length > 0
    );

  // Whether the account has been confirmed found — used only to swap the
  // Pay button's label, so the "ទិញឥឡូវនេះ" (Buy Now) button only appears
  // once the account lookup has actually succeeded (not on error/not-found).
  // It doesn't block submitting; canSubmit is unchanged.
  //
  // Roblox: the lookup result IS the account (displayName etc.), so only a
  // confirmed match counts.
  //
  // Nickname/ID games: "not_found" means the service confirmed this ID is
  // invalid, so that still blocks. But "unavailable"/"unsupported" mean the
  // service couldn't check at all — the UI tells the user they can continue
  // anyway in that case, so those must NOT be stuck on the placeholder.
  // Games with a check: until the account is checked, the Pay button
  // scrolls back up to the ID box instead of being dead.
  const step1Ref = useRef<HTMLDivElement | null>(null);

  const accountChecked = robuxGame
    ? !!robloxAccount
    : !supportsLookup ||
      (nicknameStatus !== "idle" &&
      nicknameStatus !== "checking" &&
      nicknameStatus !== "not_found");

  const needsCheck = !robuxGame && supportsLookup && !accountChecked;

  function goToCheck() {
    step1Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const zoneOk = !useZoneField || serverId.trim().length > 0;
    if (isValidUid(uid) && zoneOk) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (nicknameStatus !== "checking") runLookup();
    } else {
      step1Ref.current?.querySelector("input")?.focus({ preventScroll: true });
    }
  }

  // Restore anything they'd already typed before we asked them to sign in
  // (handleSubmit saves it just before opening the sign-in popup). Runs
  // once, right after they land back on this page from Google.
  useEffect(() => {
    const draft = loadDraft<{
      uid?: string;
      serverId?: string;
      selected?: string | null;
      cart?: Record<string, number>;
    }>(draftKey);
    if (!draft) return;

    if (draft.uid) setUid(draft.uid);
    if (draft.serverId) setServerId(draft.serverId);
    if (cartMode) {
      if (draft.cart) {
        const validIds = new Set(products.map((p) => p.id));
        const restored: Record<string, number> = {};
        for (const [id, qty] of Object.entries(draft.cart)) {
          if (validIds.has(id) && qty > 0) restored[id] = qty;
        }
        if (Object.keys(restored).length > 0) setCart(restored);
      }
    } else if (draft.selected) {
      setSelected(draft.selected);
    }

    restoredFromDraftRef.current = true;
    clearDraft(draftKey);
    // Intentionally once-only: this restores a one-time draft, not a
    // subscription to draftKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once signed in, pre-fill the UID / Zone-Server with whatever they used
  // last time on this game — unless we just restored a pre-sign-in draft,
  // or they've already typed something themselves.
  useEffect(() => {
    if (!user || giftcardGame || restoredFromDraftRef.current || uid.trim()) return;

    let cancelled = false;
    fetch(`/api/auth/saved-id?gameId=${encodeURIComponent(game.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.saved) return;
        setUid((current) => current || data.saved.uid || "");
        if (needsServer) {
          setServerId((current) => current || data.saved.serverId || "");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function checkRobloxAvatar() {
    if (
      !robuxGame ||
      !uid.trim() ||
      !isValidUid(uid)
    ) {
      return;
    }

    setRobloxChecking(true);
    setRobloxError(null);
    setRobloxAccount(null);

    try {
      const res = await fetch(
        "/api/roblox/lookup",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            username: uid.trim(),
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error ||
            "Roblox account not found"
        );
      }

      setRobloxAccount(data);
    } catch (err: any) {
      setRobloxError(
        err.message ||
          "Roblox account not found"
      );
    } finally {
      setRobloxChecking(false);
    }
  }

  const orderTotalUsd = cartMode
    ? cartSubtotal
    : selectedProduct?.priceUsd ?? 0;

  async function applyPromo() {
    if (
      !promoInput.trim() ||
      orderTotalUsd <= 0
    ) {
      return;
    }

    setPromoLoading(true);
    setPromoError(null);
    setPromoApplied(null);

    try {
      const res = await fetch(
        "/api/promo-codes/validate",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            code: promoInput.trim(),
            orderAmountUsd: orderTotalUsd,
            // Lets the server check package-restricted coupons against what's
            // actually in the cart, and discount only the matching line(s).
            productIds: (cartMode ? cartLines : selectedProduct ? [{ product: selectedProduct, quantity: 1 }] : [])
              .map((line) => line.product.id),
            lineItems: (cartMode ? cartLines : selectedProduct ? [{ product: selectedProduct, quantity: 1 }] : [])
              .map((line) => ({
                productId: line.product.id,
                lineTotalUsd: line.product.priceUsd * line.quantity,
              })),
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error ||
            "Invalid promo code"
        );
      }

      setPromoApplied(data);
    } catch (err: any) {
      setPromoError(
        err.message ||
          "Invalid promo code"
      );
    } finally {
      setPromoLoading(false);
    }
  }

  function removePromo() {
    setPromoApplied(null);
    setPromoInput("");
    setPromoError(null);
  }

  // Package-restricted coupons: if the shopper changes package after applying
  // a coupon tied to one exact package, drop it here so the price shown
  // matches what the server will charge (it rejects the order otherwise).
  const promoIdsKey = JSON.stringify(
    (cartMode
      ? cartLines
      : selectedProduct
        ? [{ product: selectedProduct, quantity: 1 }]
        : []
    ).map((line) => line.product.id)
  );

  useEffect(() => {
    if (!promoApplied?.applicableProductId) return;

    const ids: string[] = JSON.parse(promoIdsKey);
    if (!ids.includes(promoApplied.applicableProductId)) {
      setPromoApplied(null);
      setPromoInput("");
      setPromoError(
        `That promo code only works on "${promoApplied.applicableProductName ?? "another package"}"`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoIdsKey]);

  // Recompute the coupon discount from the *current* cart rather than reusing
  // the amount the server returned at apply time, so changing quantities (or
  // a multi-item cart) can't leave a stale total on screen. Mirrors the
  // server's rule in /api/orders and /api/promo-codes/validate exactly.
  const promoDiscount = (() => {
    if (!promoApplied) return 0;

    const lines = (cartMode
      ? cartLines
      : selectedProduct
        ? [{ product: selectedProduct, quantity: 1 }]
        : []
    ).map((line) => ({
      productId: line.product.id,
      lineTotalUsd: line.product.priceUsd * line.quantity,
    }));

    const restrictedId = promoApplied.applicableProductId;
    const base = restrictedId
      ? lines
          .filter((line) => line.productId === restrictedId)
          .reduce((sum, line) => sum + line.lineTotalUsd, 0)
      : lines.reduce((sum, line) => sum + line.lineTotalUsd, 0);

    if (base <= 0) return 0;

    const raw =
      promoApplied.discountType === "PERCENT"
        ? (base * promoApplied.discountValue) / 100
        : promoApplied.discountValue;

    return Math.round(Math.min(raw, base) * 100) / 100;
  })();

  const priceAfterPromo = Math.max(
    0,
    Math.round((orderTotalUsd - promoDiscount) * 100) / 100
  );

  const pointsDiscount =
    usePoints &&
    canRedeemPoints &&
    user
      ? Math.min(
          user.pointsValueUsd,
          priceAfterPromo
        )
      : 0;

  const effectivePrice =
    Math.round(
      (priceAfterPromo -
        pointsDiscount) *
        100
    ) / 100;

  // Wallet can only pay the FULL total (no partial wallet+QR). Computed
  // here, after effectivePrice is known.
  const walletCanCover =
    user != null && effectivePrice > 0 && walletUsd >= effectivePrice;

  async function handleSubmit(
    e: React.FormEvent
  ) {
    e.preventDefault();

    if (!canSubmit || submitting) return;

    if (!user && GOOGLE_LOGIN_REQUIRED) {
      // Keep what they've filled in so it's still here once they're back
      // from signing in, then send them there instead of submitting.
      saveDraft(draftKey, {
        uid,
        serverId,
        selected,
        cart: cartMode ? cart : undefined,
      });
      requireLogin();
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const usesCart =
        cartMode &&
        (
          cartLines.length > 1 ||
          (cartLines[0]?.quantity ?? 0) > 1
        );

      const res = await fetch(
        "/api/orders",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            gameId: game.id,

            ...(usesCart
              ? {
                  items: cartLines.map(
                    (line) => ({
                      productId:
                        line.product.id,
                      quantity:
                        line.quantity,
                    })
                  ),
                }
              : {
                  productId: cartMode
                    ? cartLines[0]?.product.id
                    : selected,
                }),

            playerUid: giftcardGame ? "giftcard" : uid.trim(),

            serverId: needsServer
              ? serverId.trim()
              : undefined,

            paymentMethod: method,

            promoCode:
              promoApplied?.code ||
              undefined,

            payWithWallet:
              payWithWallet || undefined,

            playerNickname:
              nickname || undefined,

            pointsToRedeem:
              usePoints && user
                ? user.points
                : undefined,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        if (isLoginRequired(res, data)) {
          saveDraft(draftKey, {
            uid,
            serverId,
            selected,
            cart: cartMode ? cart : undefined,
          });
          requireLogin();
          setSubmitting(false);
          return;
        }
        throw new Error(
          data.error ||
            "Failed to create order"
        );
      }

      window.location.href =
        data.redirectUrl;
    } catch (err: any) {
      setError(
        err.message ||
          "Failed to create order"
      );

      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-8">

        {/* LEFT COLUMN */}
        <div className="space-y-8">

          {/* STEP 1 (hidden for gift cards) */}
          {!giftcardGame && (
          <div className="fade-up scroll-mt-24" ref={step1Ref}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                1
              </div>

              <h2 className="font-display text-xl font-bold">
                បញ្ចូលអាខោនរបស់អ្នក
              </h2>
            </div>

            <div className="card p-5 sm:p-6 space-y-4">

              <div
                className={
                  useZoneField
                    ? "grid grid-cols-[1fr_120px] gap-3"
                    : ""
                }
              >
                <div>
                  <label className="label">
                    {robuxGame
                      ? "Username"
                      : useZoneField
                      ? "User ID"
                      : game.uidLabel}
                    {useZoneField && !robuxGame && (
                      <span className="text-red-400"> *</span>
                    )}
                  </label>

                  <input
                    type="text"
                    value={uid}
                    onChange={(e) => {
                      setUid(e.target.value);

                      if (robuxGame) {
                        setRobloxAccount(null);
                        setRobloxError(null);
                      }

                      resetLookup();
                    }}
                    placeholder={
                      robuxGame
                        ? "Enter your Roblox username"
                        : game.uidExample ||
                          "Enter your player ID"
                    }
                    className="input font-mono text-lg py-3.5"
                    required
                  />

                  {uid &&
                    !isValidUid(uid) && (
                      <p className="text-xs text-red-400 mt-1">
                        Must be 3–20 characters.
                      </p>
                    )}
                </div>

                {useZoneField && (
                  <div>
                    <label className="label">
                      {idConfig?.serverLabel ?? "Zone ID"}
                      <span className="text-red-400"> *</span>
                    </label>

                    <input
                      type="text"
                      value={serverId}
                      onChange={(e) =>
                        setServerId(
                          e.target.value
                        )
                      }
                      placeholder={idConfig?.serverPlaceholder ?? "1234"}
                      className="input font-mono text-lg py-3.5"
                      required
                    />
                  </div>
                )}
              </div>

              {/* CHECK USER ID + inline result (only games FazerCards can check).
                  The verified-name pill sits on the same row as the button so the
                  container doesn't stretch to leave space below it. */}
              {!robuxGame && supportsLookup && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Left slot: compact results — spinner, verified, region-block */}
                  <div>
                    {nicknameStatus === "checking" && (
                      <div className="flex items-center gap-2 text-sm text-fox-muted">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying account…
                      </div>
                    )}

                    {nicknameStatus === "verified" && nickname && !regionBlocked && (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-sm text-green-300">
                        <UserRoundCheck className="h-4 w-4" />
                        Player: <strong>{nickname}</strong>
                      </div>
                    )}

                    {regionBlocked && (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-300">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>
                          <strong>{nickname}</strong> — wrong region, please select another server.
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (debounceRef.current) {
                        clearTimeout(debounceRef.current);
                      }
                      if (!supportsLookup) {
                        setNickname(null);
                        setNicknameStatus("unsupported");
                        return;
                      }
                      runLookup();
                    }}
                    disabled={
                      !isValidUid(uid) ||
                      (useZoneField && serverId.trim().length === 0) ||
                      nicknameStatus === "checking"
                    }
                    className="btn-ghost text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {nicknameStatus === "checking" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserRoundCheck className="h-4 w-4" />
                    )}
                    ពិនិត្យមើលអាខោន
                  </button>
                </div>
              )}

              {/* ROBLOX AVATAR */}
              {robuxGame && (
                <div className="flex flex-col gap-3">

                  <button
                    type="button"
                    onClick={checkRobloxAvatar}
                    disabled={
                      robloxChecking ||
                      !isValidUid(uid)
                    }
                    className="btn-ghost w-full sm:w-auto self-start text-sm disabled:opacity-50"
                  >
                    {robloxChecking ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Checking…
                      </>
                    ) : (
                      "ពិនិត្យមើលអាខោន"
                    )}
                  </button>

                  {robloxAccount && (
                    <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 flex items-center gap-4">

                      <img
                        src={
                          robloxAccount.avatarUrl
                        }
                        alt="Roblox avatar"
                        loading="lazy"
                        decoding="async"
                        className="h-20 w-20 rounded-xl border border-fox-border object-cover bg-fox-bg"
                      />

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-green-200">
                            {
                              robloxAccount.displayName
                            }
                          </span>

                          <UserRoundCheck className="h-4 w-4 text-green-400" />
                        </div>

                        <div className="text-sm text-fox-muted">
                          @{robloxAccount.name}
                        </div>

                        <div className="text-xs text-fox-muted mt-1 font-mono">
                          User ID:{" "}
                          {robloxAccount.id}
                        </div>
                      </div>
                    </div>
                  )}

                  {robloxError && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                      {robloxError}
                    </div>
                  )}
                </div>
              )}

              {/* LOOKUP ERRORS (successful and region results are beside the check button) */}
              {!robuxGame && ["not_found", "unavailable", "unsupported"].includes(nicknameStatus) && (
                <div>
                  {nicknameStatus === "not_found" && (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                      <AlertCircle className="h-4 w-4" />
                      ID not found — please check your{" "}
                      {useZoneField
                        ? `User ID and ${idConfig?.serverLabel ?? "Zone ID"}`
                        : "ID"}.
                    </div>
                  )}

                  {nicknameStatus === "unavailable" && (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
                      <AlertCircle className="h-4 w-4" />
                      Couldn&apos;t verify right now — you can still continue.
                    </div>
                  )}

                  {nicknameStatus === "unsupported" && (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-fox-border bg-fox-card/60 px-3 py-2 text-sm text-fox-muted">
                      <AlertCircle className="h-4 w-4" />
                      Verification isn&apos;t available for this game yet — you can still continue.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          )}

          {/* STEP 2 — PACKAGES */}
          <div className="fade-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                {giftcardGame ? 1 : 2}
              </div>

              <h2 className="font-display text-xl font-bold">
                {robuxGame
                  ? "ជ្រើសរើសកញ្ចប់ដែរអ្នកចង់បាន"
                  : "ជ្រើសរើសកញ្ចប់ដែរអ្នកចង់បាន"}
              </h2>
            </div>

            {robuxGame && !isQuickLoginGame(game) && (
              <div className="mb-4">
                <RobuxStockBadge />
              </div>
            )}

            {!cartMode && popularProducts.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2">
                  <Star className="h-5 w-5 text-fox-primary" fill="currentColor" />
                  <h3 className="font-display text-lg font-bold text-fox-primary">
                    Popular
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {popularProducts.map((product) =>
                    renderTile(product, "large", "popular")
                  )}
                </div>

                <h3 className="mt-6 font-display text-lg font-bold">
                  All Packages
                </h3>
              </div>
            )}

            {!cartMode && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {products.map((product) =>
                  renderTile(product, "compact", "all")
                )}
              </div>
            )}

            {/* Cart games (Roblox / Quick Login / Robux Giftcard) get the
                original cards with quantity controls */}
            {cartMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {products.map((product) => {
                const inCart =
                  !!cart[product.id];

                const unavailable = isRobuxProductAvailable(
                  product,
                  currentRobuxStock
                ) === false;

                const isSelected = inCart;

                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={unavailable}
                    onClick={() => {
                      if (cartMode) {
                        toggleCartCard(
                          product.id
                        );
                      } else {
                        pickProduct(product);
                      }
                    }}
                    className={`
                      card relative p-5 text-left transition-all
                      ${
                        isSelected
                          ? "border-fox-primary ring-1 ring-fox-primary/50"
                          : "hover:border-fox-primary/40"
                      }
                      ${
                        unavailable
                          ? "opacity-40 cursor-not-allowed"
                          : ""
                      }
                    `}
                  >
                    {isSelected && (
                      <div className="absolute top-3 right-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-fox-primary text-black">
                          <Check className="h-4 w-4" />
                        </div>
                      </div>
                    )}

                    {/* Phone: image on top. sm+: image on the right, text on the left. */}
                    <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center sm:justify-between">
                      {product.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-12 w-12 shrink-0 rounded-lg object-cover sm:h-28 sm:w-28"
                        />
                      )}

                    <div className={product.imageUrl ? "min-w-0 pr-8 sm:flex-1 sm:pr-0" : "min-w-0 pr-8 sm:flex-1"}>

                      {product.badge && (
                        <div className="inline-block text-xs px-2 py-1 rounded-full bg-fox-primary/10 text-fox-primary mb-3">
                          {product.badge}
                        </div>
                      )}

                      <div className="font-display text-xl font-bold">
                        {amountLabel(product, game.currencyName) || product.name}
                      </div>

                      {amountLabel(product, game.currencyName) && displayName(product) ? (
                        <div className="text-fox-muted text-sm mt-2">
                          {displayName(product)}
                        </div>
                      ) : null}

                      <div className="font-display text-xl font-bold mt-4">
                        <DualPrice usd={product.priceUsd} />
                      </div>

                      {unavailable && (
                        <div className="text-xs text-red-400 mt-2">
                          អស់ហើយ
                        </div>
                      )}

                      {/* QUANTITY (cart games) */}
                      {cartMode &&
                        inCart &&
                        !unavailable && (
                          <div
                            className="flex items-center gap-3 mt-4"
                            onClick={(e) =>
                              e.stopPropagation()
                            }
                          >
                            <button
                              type="button"
                              onClick={() =>
                                changeQty(
                                  product.id,
                                  -1
                                )
                              }
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-fox-border hover:border-fox-primary"
                            >
                              <Minus className="h-4 w-4" />
                            </button>

                            <span className="font-bold min-w-6 text-center">
                              {cart[product.id]}
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                changeQty(
                                  product.id,
                                  1
                                )
                              }
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-fox-border hover:border-fox-primary"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                    </div>
                    </div>
                  </button>
                );
              })}
            </div>
            )}

            {cartExceedsStock && (
              <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                Your selected packages require{" "}
                {cartRobuxTotal.toLocaleString()} Robux,
                but only{" "}
                {currentRobuxStock?.toLocaleString()} are
                currently available.
              </div>
            )}
          </div>

          {/* STEP 3 — PROMO */}
          <div className="fade-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                {giftcardGame ? 2 : 3}
              </div>

              <h2 className="font-display text-xl font-bold">
                Promo Code
              </h2>
            </div>

            <div className="card p-5 sm:p-6">

              {!promoApplied ? (
                <>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fox-muted" />

                      <input
                        type="text"
                        value={promoInput}
                        onChange={(e) =>
                          setPromoInput(
                            e.target.value
                          )
                        }
                        placeholder="Enter promo code"
                        className="input pl-10"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={applyPromo}
                      disabled={
                        promoLoading ||
                        !promoInput.trim() ||
                        orderTotalUsd <= 0
                      }
                      className="btn-ghost disabled:opacity-50"
                    >
                      {promoLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Apply"
                      )}
                    </button>
                  </div>

                  {promoError && (
                    <p className="text-sm text-red-400 mt-3">
                      {promoError}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-green-300">
                      Promo Applied
                    </div>

                    <div className="text-xs text-fox-muted">
                      {promoApplied.code}
                      {promoApplied.applicableProductName ? (
                        <>
                          <span className="ml-2"> · </span>
                          only works on &quot;{promoApplied.applicableProductName}&quot;
                        </>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={removePromo}
                    className="text-fox-muted hover:text-red-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* STEP 4 — LOYALTY */}
          {user && (
            <div className="fade-up">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                  {giftcardGame ? 3 : 4}
                </div>

                <h2 className="font-display text-xl font-bold">
                  Loyalty Points
                </h2>
              </div>

              <div className="card p-5">
                <label className="flex items-center justify-between gap-4 cursor-pointer">

                  <div className="flex items-center gap-3">
                    <Coins className="h-5 w-5 text-fox-primary" />

                    <div>
                      <div className="font-semibold">
                        Use loyalty points
                      </div>

                      <div className="text-sm text-fox-muted">
                        You have{" "}
                        {user.points.toLocaleString()}{" "}
                        points
                      </div>
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={usePoints}
                    disabled={!canRedeemPoints}
                    onChange={(e) =>
                      setUsePoints(
                        e.target.checked
                      )
                    }
                    className="h-4 w-4"
                  />
                </label>

                {!canRedeemPoints && (
                  <p className="text-xs text-fox-muted mt-3">
                    You need at least{" "}
                    {user.minRedeemPoints} points to
                    redeem.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* PAYMENT */}
          <div className="fade-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                {giftcardGame ? (user ? 4 : 3) : user ? 5 : 4}
              </div>

              <h2 className="font-display text-xl font-bold">
                Payment
              </h2>
            </div>

            <div className="card p-5 sm:p-6">

              {user && (
                <button
                  type="button"
                  onClick={() => setPayWithWallet(!payWithWallet)}
                  disabled={!walletCanCover && !payWithWallet}
                  className={`w-full rounded-xl border p-4 mb-3 text-left transition-colors ${
                    payWithWallet
                      ? "border-fox-primary/60 bg-fox-primary/10"
                      : "border-fox-border bg-fox-card hover:border-fox-primary/40"
                  } ${!walletCanCover && !payWithWallet ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">
                        💰 Wallet  {walletUsd.toFixed(2)}$
                      </div>
                      <div className="text-sm text-fox-muted">
                        {!walletCanCover
                          ? `Balance not enough (need ${effectivePrice.toFixed(2)}$)`
                          : "Pay instantly from your wallet balance"}
                      </div>
                    </div>
                    {payWithWallet ? (
                      <Check className="h-5 w-5 text-fox-primary" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border border-fox-border" />
                    )}
                  </div>
                </button>
              )}

              <div className={`rounded-xl border p-4 ${payWithWallet ? "border-fox-border opacity-60" : "border-fox-primary/40 bg-fox-primary/5"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">
                      KHQR Payment
                    </div>

                    <div className="text-sm text-fox-muted">
                      Secure instant payment
                    </div>
                  </div>

                  {!payWithWallet && <Check className="h-5 w-5 text-fox-primary" />}
                </div>
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                onClick={(e) => {
                  if (needsCheck) {
                    e.preventDefault();
                    goToCheck();
                  }
                }}
                disabled={
                  submitting ||
                  (!canSubmit && !needsCheck)
                }
                className="btn-primary w-full mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Creating Order…
                  </>
                ) : !accountChecked ? (
                  <>សូមចុចពិនិត្យមើលអាខោនរបស់អ្នកសិន</>
                ) : (
                  <>
                    ទិញឥឡូវនេះ
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-2 mt-4 text-xs text-fox-muted">
                <Lock className="h-3.5 w-3.5" />
                Secure payment
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN — ORDER SUMMARY */}
        <div className="hidden lg:block">
          <div className="sticky top-24">
            <div className="card-glow p-6 border border-fox-primary/20">

              <h3 className="font-display text-sm font-bold uppercase tracking-wider text-fox-muted mb-5">
                Order Summary
              </h3>

              {cartMode ? (
                cartLines.length > 0 ? (
                  <div className="space-y-4">

                    {cartLines.map(
                      (line) => (
                        <div
                          key={
                            line.product.id
                          }
                          className="flex justify-between gap-3 text-sm"
                        >
                          <div>
                            <div>
                              {giftcardGame
                                ? line.product.name
                                : `${line.product.amount} ${game.currencyName}`}
                            </div>

                            <div className="text-xs text-fox-muted">
                              Qty:{" "}
                              {line.quantity}
                            </div>
                          </div>

                          <div className="font-semibold">
                            {format(
                              line.product.priceUsd *
                                line.quantity
                            )}
                          </div>
                        </div>
                      )
                    )}

                    {!giftcardGame && (
                      <div className="border-t border-fox-border pt-4">

                        <div className="flex justify-between text-sm">
                          <span className="text-fox-muted">
                            Total Robux
                          </span>

                          <span>
                            {cartRobuxTotal.toLocaleString()}
                          </span>
                        </div>

                        {uid && (
                          <div className="flex justify-between text-sm mt-3">
                            <span className="text-fox-muted">
                              Username
                            </span>

                            <span className="font-mono text-xs">
                              {uid}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-fox-muted">
                    Pick one or more packages.
                  </p>
                )
              ) : selectedProduct ? (
                <div className="space-y-4">

                  <div className="flex justify-between">
                    <span>{amountLabel(selectedProduct, game.currencyName) || selectedProduct.name}</span>

                    <span>
                      {format(
                        selectedProduct.priceUsd
                      )}
                    </span>
                  </div>

                  {uid && (
                    <div className="flex justify-between text-sm">
                      <span className="text-fox-muted">
                        Player ID
                      </span>

                      <span className="font-mono text-xs">
                        {uid}
                      </span>
                    </div>
                  )}

                  {serverId &&
                    needsServer && (
                      <div className="flex justify-between text-sm">
                        <span className="text-fox-muted">
                          Server
                        </span>

                        <span>
                          {serverId}
                        </span>
                      </div>
                    )}
                </div>
              ) : (
                <p className="text-sm text-fox-muted">
                  Select a package to see pricing.
                </p>
              )}

              {orderTotalUsd > 0 && (
                <div className="mt-6 pt-5 border-t border-fox-border space-y-3">

                  <div className="flex justify-between text-sm">
                    <span className="text-fox-muted">
                      Subtotal
                    </span>

                    <span>
                      {format(orderTotalUsd)}
                    </span>
                  </div>

                  {promoApplied && (
                    <div className="flex justify-between text-sm text-green-400">
                      <span>
                        Promo discount
                      </span>

                      <span>
                        -
                        {format(
                          promoDiscount
                        )}
                      </span>
                    </div>
                  )}

                  {pointsDiscount > 0 && (
                    <div className="flex justify-between text-sm text-green-400">
                      <span>
                        Points discount
                      </span>

                      <span>
                        -
                        {format(
                          pointsDiscount
                        )}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between pt-3 text-lg font-display font-bold">
                    <span>Total</span>

                    <span className="text-fox-primary">
                      {format(effectivePrice)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* First Top-Up Bonus confirmation */}
      {firstTopUpCandidate && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            aria-hidden
            onClick={() => setFirstTopUpCandidate(null)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="first-topup-title"
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-fox-border bg-fox-card shadow-2xl"
          >
            {/* Header band */}
            <div className="relative bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent px-5 pt-5 pb-4 border-b border-fox-border">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/30">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0 pr-6">
                  <h3
                    id="first-topup-title"
                    className="font-display text-lg font-bold leading-snug"
                  >
                    បញ្ជាក់កញ្ចប់បញ្ចូលលើកដំបូង
                  </h3>
                  <p className="mt-0.5 text-xs text-fox-muted">
                    First Top-Up Bonus
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFirstTopUpCandidate(null)}
                className="absolute right-3 top-3 rounded-lg p-1.5 text-fox-muted hover:bg-white/5 hover:text-fox-text"
                aria-label="បិទ"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3.5">
                <p className="text-sm leading-relaxed text-amber-100/90">
                  សូមបញ្ជាក់ថា អ្នក{" "}
                  <strong className="text-amber-200">មិនធ្លាប់</strong> បញ្ចូលកញ្ចប់នេះ
                  ទៅលើគណនី{" "}
                  <strong className="text-amber-200">
                    {uid.trim() || "របស់អ្នក"}
                  </strong>{" "}
                  ពីមុនទេ។
                </p>
              </div>

              <p className="text-sm leading-relaxed text-fox-muted">
                កញ្ចប់ <strong className="text-fox-text">បញ្ចូលលើកដំបូង</strong> នឹងផ្តល់{" "}
                <strong className="text-fox-text">{game.currencyName}</strong> បន្ថែម
                តែពេលបញ្ចូលលើកដំបូងប៉ុណ្ណោះ។ ប្រសិនបើគណនីនេះ
                ធ្លាប់បញ្ចូលកញ្ចប់នេះរួចហើយ ប្រព័ន្ធនឹងបដិសេធការបញ្ជាទិញ។
              </p>

              <div className="rounded-xl border border-fox-border bg-fox-bg/60 p-3.5 flex items-center justify-between gap-3">
                <div>
                  <div className="font-display text-base font-bold text-fox-text">
                    {amountLabel(firstTopUpCandidate, game.currencyName)}
                  </div>
                  <div className="text-xs text-fox-muted mt-0.5">
                    {firstTopUpCandidate.name}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <DualPrice usd={firstTopUpCandidate.priceUsd} />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex gap-3">
              <button
                type="button"
                onClick={() => setFirstTopUpCandidate(null)}
                className="btn-ghost flex-1 !py-2.5 text-sm justify-center"
              >
                ត្រឡប់ក្រោយ
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(firstTopUpCandidate.id);
                  setFirstTopUpCandidate(null);
                }}
                className="btn-primary flex-1 !py-2.5 text-sm justify-center"
              >
                បញ្ជាក់
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}