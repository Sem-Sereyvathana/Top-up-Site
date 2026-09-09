import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { attemptAdminLogin, setSessionCookie, clearSessionCookie } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
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
