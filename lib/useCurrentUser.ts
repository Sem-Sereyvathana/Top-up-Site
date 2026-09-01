"use client";

import { useEffect, useState } from "react";

export interface CurrentUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  points: number;
  pointsValueUsd: number;
  minRedeemPoints: number;
}

// Shared client hook for reading the logged-in user (or null for guests).
// Used by Header, TopUpForm and the account pages so they all stay in sync
// with a single fetch pattern.
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { user, loading, refresh };
}
