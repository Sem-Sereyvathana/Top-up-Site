// One helper for "which visitor IP is this request really from".
//
// Why not just read x-forwarded-for directly?
//   A visitor can SEND any x-forwarded-for header they want. Each proxy in
//   the chain APPENDS the visitor's real IP to it, it doesn't replace it.
//   Render (and Cloudflare in front of it) sit between the visitor and the
//   app, so the LAST entry in the chain — the one added by the proxy the
//   app trusts — is the trustworthy one. Taking the FIRST entry (what the
//   old code did) reads the value the visitor typed in themselves, so IP
//   rate limits could be bypassed with a single header.
//
// Trust order:
//   1. CF-Connecting-IP  — set by Cloudflare from its own TCP connection
//   2. True-Client-IP    — Cloudflare's older header, same guarantee
//   3. x-forwarded-for LAST entry — what Render appends
//
// NOTE (to verify on the live Render service): if the values don't line up
// as expected, log all three headers from a diagnostic route and compare.
// Until verified, treat IP limits as a weak signal and lean on the
// account-level limits too.
export function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const tc = req.headers.get("true-client-ip");
  if (tc) return tc.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
}
