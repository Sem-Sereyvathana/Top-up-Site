import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { completeTotpLogin, setSessionCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

const schema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(6).max(12),
});

// Step 2 of admin login for accounts with app authentication enabled.
// Called with the pendingToken returned by POST /api/admin/auth once the
// password was verified, plus the 6-digit code from the authenticator app
// (or an 8+ character backup code).
export async function POST(req: NextRequest) {
  try {
    // Same 10-per-10-minutes-per-IP limit as the password step — see the
    // comment in app/api/admin/auth/route.ts for why this lives here
    // instead of middleware.ts.
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`admin-auth:${ip}`, 10, 10 * 60 * 1000, { failClosed: true }))) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const result = await completeTotpLogin(parsed.data.pendingToken, parsed.data.code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    await setSessionCookie(result.token);
    return NextResponse.json({ ok: true, email: result.email });
  } catch (err) {
    // Log details server-side; return a generic message to the browser.
    console.error("[admin/auth/totp] verify failed:", err);
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 500 });
  }
}
