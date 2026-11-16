"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The old Accounts-only checkout is gone: every buy button now routes to the
// COMBINED checkout (/cart/checkout), which sums both marketplace carts into
// one payment. This page just forwards anyone with the old URL saved.
export default function AccountsCheckoutRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/cart/checkout");
  }, [router]);
  return null;
}
