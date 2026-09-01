import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

const SESSION_COOKIE = "rithtopup_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export interface UserSession {
  userId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
}

export async function createUserSession(payload: UserSession): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(getSecret());
}

export async function verifyUserSession(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.userId) return null;
    return {
      userId: payload.userId as string,
      email: (payload.email as string) ?? null,
      phone: (payload.phone as string) ?? null,
      name: (payload.name as string) ?? null,
    };
  } catch {
    return null;
  }
}

export async function setUserSessionCookie(token: string) {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL,
    path: "/",
  });
}

export async function clearUserSessionCookie() {
  cookies().delete(SESSION_COOKIE);
}

// Reads + verifies the session cookie. Returns null for guests — callers
// should treat that as "continue as guest", never as an error.
export async function getCurrentUser(): Promise<UserSession | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await verifyUserSession(token);
}

// Fetches the live DB record for the current session (fresh points balance
// etc). Returns null if not logged in, or if the account was deactivated.
export async function getCurrentUserRecord() {
  const session = await getCurrentUser();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) return null;
  return user;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+][0-9\s-]{6,19}$/;

export function isEmail(identifier: string) {
  return EMAIL_RE.test(identifier.trim());
}
export function isPhone(identifier: string) {
  return PHONE_RE.test(identifier.trim());
}

export function normalizePhone(phone: string) {
  return phone.replace(/[\s-]/g, "");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export { SESSION_COOKIE };
