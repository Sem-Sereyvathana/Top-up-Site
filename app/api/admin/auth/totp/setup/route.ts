import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

const ISSUER = "RITHTOPUP Admin";

function randomBackupCode() {
  // 10 chars, groups of 5, uppercase — easy to read back, hard to guess.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

// GET — start enrollment: generates a new (unconfirmed) secret, stores it
// on the admin row, and returns a QR code + the raw secret for manual
// entry. Calling this again before confirming just issues a fresh secret,
// so refreshing the page mid-setup is safe. totpEnabled stays false until
// POST below confirms the admin actually scanned it correctly.
export async function GET() {
  try {
    const session = await requireAdmin();
    const admin = await prisma.admin.findUnique({ where: { id: session.adminId } });
    if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (admin.totpEnabled) {
      return NextResponse.json({ error: "App authentication is already enabled" }, { status: 400 });
    }

    const secret = authenticator.generateSecret();
    await prisma.admin.update({ where: { id: admin.id }, data: { totpSecret: secret } });

    const otpauth = authenticator.keyuri(admin.email, ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    return NextResponse.json({ secret, qrDataUrl });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/auth/totp/setup] GET failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

const confirmSchema = z.object({ code: z.string().min(6).max(8) });

// POST — confirm enrollment: verifies the code against the secret issued
// above, and only then flips totpEnabled on and issues one-time backup
// codes (shown once, hashed before storage).
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const admin = await prisma.admin.findUnique({ where: { id: session.adminId } });
    if (!admin || !admin.totpSecret) {
      return NextResponse.json({ error: "Start enrollment first" }, { status: 400 });
    }
    if (admin.totpEnabled) {
      return NextResponse.json({ error: "App authentication is already enabled" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter the 6-digit code" }, { status: 400 });
    }

    const valid = authenticator.check(parsed.data.code.trim(), admin.totpSecret);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect code — check your app and try again" }, { status: 400 });
    }

    const backupCodes = Array.from({ length: 8 }, randomBackupCode);
    const hashed = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    await prisma.admin.update({
      where: { id: admin.id },
      data: { totpEnabled: true, totpBackupCodes: hashed },
    });

    await writeAudit({ action: "admin.totp.enabled", targetType: "admin", targetId: admin.id });

    // Only time these are ever readable in plaintext — show them once.
    return NextResponse.json({ ok: true, backupCodes });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/auth/totp/setup] POST failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE — turn app authentication off. Requires the current password so
// a hijacked, still-open admin tab can't silently disable 2FA.
const disableSchema = z.object({ password: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const admin = await prisma.admin.findUnique({ where: { id: session.adminId } });
    if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const parsed = disableSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Current password required" }, { status: 400 });
    }

    const ok = await bcrypt.compare(parsed.data.password, admin.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    await prisma.admin.update({
      where: { id: admin.id },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
    });

    await writeAudit({ action: "admin.totp.disabled", targetType: "admin", targetId: admin.id });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/auth/totp/setup] DELETE failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
