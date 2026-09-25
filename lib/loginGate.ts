// Client-side half of "you must sign in to buy".
//
// Any purchase button calls requireLogin() when there's no signed-in user;
// components/SignInPopup.tsx (mounted once in the root layout) listens for
// the event and shows the popup. The server returns 401 + LOGIN_REQUIRED
// from the order APIs as the real lock; isLoginRequired() lets a form
// react to that too (e.g. the session expired mid-visit).
//
// Pure data + a window event — safe to import from any client component.

export const LOGIN_REQUIRED_CODE = "LOGIN_REQUIRED";
export const LOGIN_REQUIRED_EVENT = "sharustore:login-required";

export function requireLogin(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LOGIN_REQUIRED_EVENT, {
      // Where to send the visitor back to after Google sign-in.
      detail: { next: window.location.pathname + window.location.search },
    })
  );
}

export function isLoginRequired(res: { status: number }, data: unknown): boolean {
  return (
    res.status === 401 &&
    typeof data === "object" &&
    data !== null &&
    (data as { code?: unknown }).code === LOGIN_REQUIRED_CODE
  );
}
