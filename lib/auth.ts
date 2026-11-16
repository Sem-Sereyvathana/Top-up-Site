import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { prisma } from "./prisma";

const SESSION_COOKIE = "sharustore_admin";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

// Failed-attempt lockout — applies to both the password step and the TOTP
// code step below, keyed off the same Admin row either way, so someone who
// already has the password still can't brute-force the 6-digit code.
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Short-lived token issued after a correct password when the account has
// app authentication enabled — proves the password step passed without
// creating a real session yet. Verified in a separate namespace (`type`
// claim) from a real session token so one can never be mistaken for the
// other. Never written to the session cookie.
const TOTP_PENDING_TTL = 5 * 60; // 5 minutes

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export interface AdminSession {
  adminId: string;
  email: string;
  role: string;
}

export async function createSession(payload: AdminSession): Promise<string> {
  return await new SignJWT({ ...payload, type: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    // Only a real session token counts. The short-lived "totp_pending" token
    // (issued after the password step, before the 2FA code) is signed with the
    // same secret and must never be accepted as a login.
    if (payload.type !== "session" || !payload.adminId) return null;
    return {
      adminId: payload.adminId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL,
    path: "/",
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getCurrentAdmin(): Promise<AdminSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await verifySession(token);
}

export async function requireAdmin(): Promise<AdminSession> {
  const admin = await getCurrentAdmin();
  if (!admin) throw new Error("UNAUTHORIZED");
  return admin;
}

// Defence-in-depth gate for every /api/admin/** handler.
//
// middleware.ts already blocks unsigned visitors at the edge, but its
// matcher has blind spots (paths ending in static extensions) and it runs
// on Edge where it CANNOT check the database. This helper is the second
// lock on the door: it verifies the JWT session AND re-checks the admin
// still exists and is active in the database — so a session that was valid
// when issued stops working the moment the admin is deactivated, even
// before its 7-day expiry.
//
// Returns either { ok: true, admin } or { ok: false, response } — call it
// at the top of each handler and return `response` on failure:
//   const gate = await requireAdminApi();
//   if (!gate.ok) return gate.response;
export async function requireAdminApi(): Promise<
  { ok: true; admin: AdminSession } | { ok: false; response: NextResponse }
> {
  const session = await getCurrentAdmin();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const dbAdmin = await prisma.admin.findUnique({
    where: { id: session.adminId },
    select: { active: true },
  });
  if (!dbAdmin?.active) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, admin: session };
}

// ---- Lockout helpers ----------------------------------------------------

function remainingLockMs(admin: { lockedUntil: Date | null }): number {
  if (!admin.lockedUntil) return 0;
  const ms = admin.lockedUntil.getTime() - Date.now();
  return ms > 0 ? ms : 0;
}

async function recordFailedAttempt(adminId: string) {
  // Atomic increment (single statement — no read-then-write race). Returns
  // the new attempt count, or null if the admin row is gone.
  const updated = await prisma.admin.update({
    where: { id: adminId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  }).catch(() => null);
  const attempts = updated?.failedLoginAttempts ?? 0;

  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MS);
    await prisma.admin.update({
      where: { id: adminId },
      data: { failedLoginAttempts: 0, lockedUntil },
    });
    return lockedUntil;
  }
  return null;
}

async function resetFailedAttempts(adminId: string) {
  await prisma.admin.update({
    where: { id: adminId },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

function lockMessage(ms: number) {
  const mins = Math.ceil(ms / 60000);
  return `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

// ---- Login step 1: email + password -------------------------------------

export type LoginResult =
  | { ok: false; error: string }
  | { ok: true; requiresTotp: true; pendingToken: string }
  | { ok: true; requiresTotp: false; token: string; email: string };

export async function attemptAdminLogin(email: string, password: string): Promise<LoginResult> {
  const admin = await prisma.admin.findUnique({ where: { email } });
  // Same generic error whether the email doesn't exist or the password is
  // wrong, so a caller can't use this to enumerate valid admin emails.
  const genericError = "Invalid email or password";
  if (!admin || !admin.active) return { ok: false, error: genericError };

  const lockedMs = remainingLockMs(admin);
  if (lockedMs > 0) return { ok: false, error: lockMessage(lockedMs) };

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    const lockedUntil = await recordFailedAttempt(admin.id);
    if (lockedUntil) return { ok: false, error: lockMessage(LOCKOUT_MS) };
    return { ok: false, error: genericError };
  }

  if (admin.totpEnabled) {
    const pendingToken = await new SignJWT({ adminId: admin.id, type: "totp_pending" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${TOTP_PENDING_TTL}s`)
      .sign(getSecret());
    return { ok: true, requiresTotp: true, pendingToken };
  }

  await resetFailedAttempts(admin.id);
  const token = await createSession({ adminId: admin.id, email: admin.email, role: admin.role });
  return { ok: true, requiresTotp: false, token, email: admin.email };
}

// ---- Login step 2: TOTP code (only when app authentication is on) ------

export type TotpVerifyResult =
  | { ok: false; error: string }
  | { ok: true; token: string; email: string };

export async function completeTotpLogin(pendingToken: string, code: string): Promise<TotpVerifyResult> {
  let adminId: string;
  try {
    const { payload } = await jwtVerify(pendingToken, getSecret());
    if (payload.type !== "totp_pending") throw new Error("wrong token type");
    adminId = payload.adminId as string;
  } catch {
    return { ok: false, error: "Session expired — please sign in again." };
  }

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin || !admin.active || !admin.totpEnabled || !admin.totpSecret) {
    return { ok: false, error: "Session expired — please sign in again." };
  }

  const lockedMs = remainingLockMs(admin);
  if (lockedMs > 0) return { ok: false, error: lockMessage(lockedMs) };

  const cleanCode = code.trim().replace(/\s+/g, "");
  let matched = authenticator.check(cleanCode, admin.totpSecret);

  // Fall back to backup codes (single-use, bcrypt-hashed) if the 6-digit
  // code doesn't match — lets the admin in if they've lost their device.
  let matchedBackupHash: string | null = null;
  if (!matched && cleanCode.length >= 8) {
    for (const hash of admin.totpBackupCodes) {
      if (await bcrypt.compare(cleanCode, hash)) {
        matchedBackupHash = hash;
        matched = true;
        break;
      }
    }
  }

  if (!matched) {
    const lockedUntil = await recordFailedAttempt(admin.id);
    if (lockedUntil) return { ok: false, error: lockMessage(LOCKOUT_MS) };
    return { ok: false, error: "Invalid code" };
  }

  const data: any = { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() };
  if (matchedBackupHash) {
    data.totpBackupCodes = admin.totpBackupCodes.filter((h) => h !== matchedBackupHash);
  }
  await prisma.admin.update({ where: { id: admin.id }, data });

  const token = await createSession({ adminId: admin.id, email: admin.email, role: admin.role });
  return { ok: true, token, email: admin.email };
}

export async function verifyAdminCredentials(email: string, password: string) {
  // Kept for compatibility with any other caller — no lockout/TOTP
  // awareness. The login route below uses attemptAdminLogin instead.
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin || !admin.active) return null;
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return null;
  await prisma.admin.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });
  return { adminId: admin.id, email: admin.email, role: admin.role };
}

export { SESSION_COOKIE };
