import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { attemptAdminLogin, setSessionCookie, clearSessionCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Step 1 of admin login: email + password. If the account has app
// authentication (TOTP) enabled, this returns a pendingToken instead of a
// session — the client must then call POST /api/admin/auth/totp with the
// 6-digit code to finish logging in.
export async function POST(req: NextRequest) {
  try {
    // 10 attempts per 10 minutes per IP — kept here (rather than in
    // middleware.ts) so it stays right next to the login logic it
    // protects. The TOTP step below uses the same limit/window.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await checkRateLimit(`admin-auth:${ip}`, 10, 10 * 60 * 1000))) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
    }

    const result = await attemptAdminLogin(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    if (result.requiresTotp) {
      // Password was correct, but this admin has app authentication
      // enabled — the client must submit the 6-digit code to
      // /api/admin/auth/totp before a real session is created.
      return NextResponse.json({ ok: true, requiresTotp: true, pendingToken: result.pendingToken });
    }

    await setSessionCookie(result.token);
    return NextResponse.json({ ok: true, requiresTotp: false, email: result.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[admin/auth] login failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
