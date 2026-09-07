"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ShopCartCard } from "@/components/ShopCartBrowser";

export type ShopKind = "items" | "accounts";

export interface ShopCartLine {
  card: ShopCartCard;
  quantity: number;
}

type CartMap = Record<string, ShopCartLine>;

interface ShopCartState {
  items: CartMap;
  accounts: CartMap;
}

const STORAGE_KEY = "sharu:shopCart";
const BUY_NOW_KEY = "sharu:buyNow";

const EMPTY_STATE: ShopCartState = { items: {}, accounts: {} };

function loadInitialState(): ShopCartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    return {
      items: parsed?.items ?? {},
      accounts: parsed?.accounts ?? {},
    };
  } catch {
    return EMPTY_STATE;
  }
}

interface ShopCartContextValue {
  state: ShopCartState;
  linesFor: (kind: ShopKind) => ShopCartLine[];
  countFor: (kind: ShopKind) => number;
  toggleCard: (kind: ShopKind, card: ShopCartCard) => void;
  changeQty: (kind: ShopKind, id: string, delta: number) => void;
  removeLine: (kind: ShopKind, id: string) => void;
  clear: (kind: ShopKind) => void;
  setBuyNow: (card: ShopCartCard) => void;
}

const ShopCartContext = createContext<ShopCartContextValue | null>(null);

export function ShopCartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ShopCartState>(EMPTY_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Restore from localStorage on mount (same pattern as CurrencyProvider).
  useEffect(() => {
    setState(loadInitialState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [state, hydrated]);

  const toggleCard = useCallback((kind: ShopKind, card: ShopCartCard) => {
    if (card.soldOut) return;
    setState((prev) => {
      const map = { ...prev[kind] };
      if (map[card.id]) {
        delete map[card.id];
      } else {
        map[card.id] = { card, quantity: 1 };
      }
      return { ...prev, [kind]: map };
    });
  }, []);

  const changeQty = useCallback((kind: ShopKind, id: string, delta: number) => {
    setState((prev) => {
      const line = prev[kind][id];
      if (!line) return prev;
      const nextQty = Math.min(20, line.quantity + delta);
      const map = { ...prev[kind] };
      if (nextQty <= 0) {
        delete map[id];
      } else {
        map[id] = { ...line, quantity: nextQty };
      }
      return { ...prev, [kind]: map };
    });
  }, []);

  const removeLine = useCallback((kind: ShopKind, id: string) => {
    setState((prev) => {
      const map = { ...prev[kind] };
      delete map[id];
      return { ...prev, [kind]: map };
    });
  }, []);

  const clear = useCallback((kind: ShopKind) => {
    setState((prev) => ({ ...prev, [kind]: {} }));
  }, []);

  const setBuyNow = useCallback((card: ShopCartCard) => {
    try {
      sessionStorage.setItem(BUY_NOW_KEY, JSON.stringify(card));
    } catch {
      /* ignore */
    }
  }, []);

  const linesFor = useCallback((kind: ShopKind) => Object.values(state[kind]), [state]);

  const countFor = useCallback(
    (kind: ShopKind) => Object.values(state[kind]).reduce((sum, l) => sum + l.quantity, 0),
    [state]
  );

  const value = useMemo<ShopCartContextValue>(
    () => ({ state, linesFor, countFor, toggleCard, changeQty, removeLine, clear, setBuyNow }),
    [state, linesFor, countFor, toggleCard, changeQty, removeLine, clear, setBuyNow]
  );

  return <ShopCartContext.Provider value={value}>{children}</ShopCartContext.Provider>;
}

export function useShopCart(): ShopCartContextValue {
  const ctx = useContext(ShopCartContext);
  if (!ctx) {
    throw new Error("useShopCart must be used within a ShopCartProvider");
  }
  return ctx;
}

/** One-off "Buy Now" pick — bypasses the persistent cart entirely. */
export function readBuyNow(): ShopCartCard | null {
  try {
    const raw = sessionStorage.getItem(BUY_NOW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearBuyNow() {
  try {
    sessionStorage.removeItem(BUY_NOW_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Tracks the most recent unpaid order created from checkout, per kind and
 * per mode (cart vs. buy-now), so that coming back to the checkout page
 * (e.g. via the payment screen's "Cancel and go back" link) can offer to
 * resume straight to that order's payment screen instead of making the
 * buyer fill in the username/contact form again. Cleared once the order
 * is actually paid (see MarketplaceCheckout's onPaid) or if the buyer
 * explicitly chooses to start a new order instead.
 */
export interface PendingOrderInfo {
  orderNumber: string;
  mode: "cart" | "buyNow";
  createdAt: number;
}

function pendingOrderKey(kind: ShopKind) {
  return `sharu:pendingOrder:${kind}`;
}

export function getPendingOrder(kind: ShopKind): PendingOrderInfo | null {
  try {
    const raw = localStorage.getItem(pendingOrderKey(kind));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setPendingOrder(kind: ShopKind, info: PendingOrderInfo) {
  try {
    localStorage.setItem(pendingOrderKey(kind), JSON.stringify(info));
  } catch {
    /* ignore */
  }
}

export function clearPendingOrder(kind: ShopKind) {
  try {
    localStorage.removeItem(pendingOrderKey(kind));
  } catch {
    /* ignore */
  }
}
