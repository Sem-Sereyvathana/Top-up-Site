import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { completeTotpLogin, setSessionCookie } from "@/lib/auth";

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
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[admin/auth/totp] verify failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
