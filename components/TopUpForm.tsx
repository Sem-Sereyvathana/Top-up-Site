"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  isValidUid,
  formatUsd,
  isRobuxGame,
} from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { useCurrentUser } from "@/lib/useCurrentUser";
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
  X,
} from "lucide-react";
import RobuxStockBadge from "@/components/RobuxStockBadge";

// Games that support automatic nickname lookup
const LOOKUP_SLUGS = new Set([
  "mobile-legends",
  "free-fire",
  "genshin-impact",
  "honkai-star-rail",
]);

// Games that use Zone ID
const ZONE_ID_SLUGS = new Set([
  "mobile-legends",
]);

interface Product {
  id: string;
  name: string;
  amount: number;
  bonus: number;
  priceUsd: number;
  badge: string | null;
  stock?: number | null;
}

interface Game {
  id: string;
  slug: string;
  name: string;
  currencyName: string;
  uidLabel: string;
  uidExample: string | null;
  requiresServer: boolean;
  servers: string[];
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
  const supportsLookup = LOOKUP_SLUGS.has(game.slug);
  const useZoneField = ZONE_ID_SLUGS.has(game.slug);

  const [currentRobuxStock] =
    useState<number | null>(robuxStock);

  // Normal games use one selected package
  const [selected, setSelected] =
    useState<string | null>(null);

  // Roblox uses multiple packages
  // IMPORTANT: starts EMPTY — no automatic package
  const [cart, setCart] = useState<Record<string, number>>(
    {}
  );

  const [uid, setUid] = useState("");

  const [serverId, setServerId] = useState(
    ZONE_ID_SLUGS.has(game.slug) || robuxGame
      ? ""
      : game.servers[0] ?? ""
  );

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

  // Nickname lookup
  type NicknameStatus =
    | "idle"
    | "checking"
    | "verified"
    | "not_found";

  const [nicknameStatus, setNicknameStatus] =
    useState<NicknameStatus>("idle");

  const [nickname, setNickname] =
    useState<string | null>(null);

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
  }, []);

  // Nickname lookup
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

    debounceRef.current = setTimeout(
      async () => {
        setNicknameStatus("checking");
        setNickname(null);

        const controller =
          new AbortController();

        abortRef.current = controller;

        try {
          const res = await fetch(
            "/api/lookup-uid",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                gameSlug: game.slug,
                uid: uid.trim(),
                server:
                  serverId.trim() || undefined,
              }),
              signal: controller.signal,
            }
          );

          const data = await res.json();

          if (controller.signal.aborted) return;

          if (
            data.verified &&
            data.nickname
          ) {
            setNickname(data.nickname);
            setNicknameStatus("verified");
          } else {
            setNicknameStatus("not_found");
          }
        } catch {
          if (!controller.signal.aborted) {
            setNicknameStatus("not_found");
          }
        }
      },
      800
    );

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
    !robuxGame &&
    (
      game.requiresServer ||
      useZoneField
    );

  const packageReady = robuxGame
    ? cartLines.length > 0 &&
      !cartExceedsStock
    : !!selectedProduct &&
      !isOutOfStock(selectedProduct);

  const robloxAvatarConfirmed =
    !robuxGame ||
    !!robloxAccount;

  const canSubmit =
    packageReady &&
    isValidUid(uid) &&
    robloxAvatarConfirmed &&
    (
      !needsServer ||
      serverId.trim().length > 0
    );

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

  const orderTotalUsd = robuxGame
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

  const priceAfterPromo = promoApplied
    ? promoApplied.finalAmountUsd
    : orderTotalUsd;

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

  async function handleSubmit(
    e: React.FormEvent
  ) {
    e.preventDefault();

    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const usesCart =
        robuxGame &&
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
                  productId: robuxGame
                    ? cartLines[0]?.product.id
                    : selected,
                }),

            playerUid: uid.trim(),

            serverId: needsServer
              ? serverId.trim()
              : undefined,

            paymentMethod: method,

            promoCode:
              promoApplied?.code ||
              undefined,

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

          {/* STEP 1 */}
          <div className="fade-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                1
              </div>

              <h2 className="font-display text-xl font-bold">
                Enter Account Info
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
                      Zone ID
                    </label>

                    <input
                      type="text"
                      value={serverId}
                      onChange={(e) =>
                        setServerId(
                          e.target.value
                        )
                      }
                      placeholder="1234"
                      className="input font-mono text-lg py-3.5"
                      required
                    />
                  </div>
                )}
              </div>

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
                      "Check Avatar"
                    )}
                  </button>

                  {robloxAccount && (
                    <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 flex items-center gap-4">

                      <img
                        src={
                          robloxAccount.avatarUrl
                        }
                        alt="Roblox avatar"
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

              {/* SERVER */}
              {game.requiresServer &&
                !useZoneField &&
                !robuxGame && (
                  <div>
                    <label className="label">
                      Server
                    </label>

                    <select
                      value={serverId}
                      onChange={(e) =>
                        setServerId(
                          e.target.value
                        )
                      }
                      className="input"
                    >
                      {game.servers.map(
                        (server) => (
                          <option
                            key={server}
                            value={server}
                          >
                            {server}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                )}

              {/* AUTO LOOKUP */}
              {supportsLookup &&
                nicknameStatus !== "idle" && (
                  <div>
                    {nicknameStatus ===
                      "checking" && (
                      <div className="flex items-center gap-2 text-sm text-fox-muted">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying account…
                      </div>
                    )}

                    {nicknameStatus ===
                      "verified" &&
                      nickname && (
                        <div className="inline-flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300">
                          <UserRoundCheck className="h-4 w-4" />
                          Player:{" "}
                          <strong>
                            {nickname}
                          </strong>
                        </div>
                      )}

                    {nicknameStatus ===
                      "not_found" && (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
                        <AlertCircle className="h-4 w-4" />
                        Couldn&apos;t verify right now
                        — you can still continue.
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>

          {/* STEP 2 — PACKAGES */}
          <div className="fade-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                2
              </div>

              <h2 className="font-display text-xl font-bold">
                {robuxGame
                  ? "Select Packages"
                  : "Select Package"}
              </h2>
            </div>

            {robuxGame && (
              <div className="mb-4">
                <RobuxStockBadge />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {products.map((product) => {
                const inCart =
                  !!cart[product.id];

                const unavailable =
                  robuxGame
                    ? !isRobuxProductAvailable(
                        product,
                        currentRobuxStock
                      )
                    : isOutOfStock(product);

                const isSelected =
                  robuxGame
                    ? inCart
                    : selected === product.id;

                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={unavailable}
                    onClick={() => {
                      if (robuxGame) {
                        toggleCartCard(
                          product.id
                        );
                      } else {
                        setSelected(
                          product.id
                        );
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

                    <div className="pr-8">

                      {product.badge && (
                        <div className="inline-block text-xs px-2 py-1 rounded-full bg-fox-primary/10 text-fox-primary mb-3">
                          {product.badge}
                        </div>
                      )}

                      <div className="font-display text-xl font-bold">
                        {product.amount.toLocaleString()}{" "}
                        {game.currencyName}
                      </div>

                      {product.bonus > 0 && (
                        <div className="text-sm text-green-400 mt-1">
                          +{product.bonus.toLocaleString()} Bonus
                        </div>
                      )}

                      <div className="text-fox-muted text-sm mt-2">
                        {product.name}
                      </div>

                      <div className="font-display text-xl font-bold mt-4">
                        {format(product.priceUsd)}
                      </div>

                      {unavailable && (
                        <div className="text-xs text-red-400 mt-2">
                          Out of stock
                        </div>
                      )}

                      {/* QUANTITY FOR ROBLOX */}
                      {robuxGame &&
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
                  </button>
                );
              })}
            </div>

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
                3
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
                  4
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
                {user ? "5" : "4"}
              </div>

              <h2 className="font-display text-xl font-bold">
                Payment
              </h2>
            </div>

            <div className="card p-5 sm:p-6">

              <div className="rounded-xl border border-fox-primary/40 bg-fox-primary/5 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">
                      KHQR Payment
                    </div>

                    <div className="text-sm text-fox-muted">
                      Secure instant payment
                    </div>
                  </div>

                  <Check className="h-5 w-5 text-fox-primary" />
                </div>
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={
                  !canSubmit ||
                  submitting
                }
                className="btn-primary w-full mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Creating Order…
                  </>
                ) : (
                  <>
                    Continue to Payment
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

              {robuxGame ? (
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
                              {
                                line.product.amount
                              }{" "}
                              Robux
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
                  </div>
                ) : (
                  <p className="text-sm text-fox-muted">
                    Pick one or more packages.
                  </p>
                )
              ) : selectedProduct ? (
                <div className="space-y-4">

                  <div className="flex justify-between">
                    <span>
                      {
                        selectedProduct.amount
                      }{" "}
                      {game.currencyName}
                    </span>

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
                          promoApplied.discountUsd
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
    </form>
  );
}