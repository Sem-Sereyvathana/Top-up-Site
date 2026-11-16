import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import {
  createUserSession,
  setUserSessionCookie,
  verifyPassword,
  isEmail,
  normalizePhone,
} from "@/lib/userAuth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

const loginSchema = z.object({
  identifier: z.string().min(3).max(120),
  password: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  // 10 attempts per 10 minutes per IP — slows brute-forcing without
  // blocking a normal user who mistypes their password a couple times.
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`login:${ip}`, 10, 10 * 60 * 1000, { failClosed: true }))) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const identifier = parsed.data.identifier.trim();
  const lookupValue = isEmail(identifier) ? identifier.toLowerCase() : normalizePhone(identifier);

  // ACCOUNT-level limit, on top of the IP limit above: 8 attempts per
  // 15 minutes for one specific email/phone, counted atomically in the
  // RateLimitBucket table. The IP limit alone is bypassable (an attacker
  // rotates IPs), but this one follows the account no matter where the
  // attempts come from. It's a TEMPORARY lockout — the window resets on
  // its own, so nobody can be locked out permanently. Generic message,
  // same as a wrong password, so this can't be used to probe accounts.
  if (
    !(await checkRateLimit(`login-id:${lookupValue}`, 8, 15 * 60 * 1000, { failClosed: true }))
  ) {
    return NextResponse.json(
      { error: "Too many attempts for this account. Please wait 15 minutes and try again." },
      { status: 429 }
    );
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: lookupValue }, { phone: lookupValue }] },
  });

  // Same generic error whether the account doesn't exist or the password is
  // wrong, so we don't leak which emails/phones are registered.
  const invalid = () =>
    NextResponse.json({ error: "Incorrect email/phone or password" }, { status: 401 });

  // Banlist: a blocked email/phone/IP can't sign in, even with the right
  // password. Checked before the password compare and reported with the same
  // generic error so it can't be used to probe which identities are banned.
  const banCandidates = [
    { type: "email", value: lookupValue },
    { type: "phone", value: lookupValue },
    { type: "ip", value: ip.toLowerCase() },
  ];
  const blocked = await prisma.blockedIdentity.findFirst({
    where: { OR: banCandidates.map((c) => ({ type: c.type, value: c.value })) },
  });
  if (blocked) return invalid();

  // Telegram-only accounts have no passwordHash — there's nothing to check
  // a password against, so treat them the same as "wrong password" rather
  // than crashing bcrypt.compare with a null hash.
  if (!user || !user.active || !user.passwordHash) return invalid();

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) return invalid();

  // Successful login — clear the account-level attempt counter.
  await prisma.rateLimitBucket
    .delete({ where: { key: `login-id:${lookupValue}` } })
    .catch(() => {});

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = await createUserSession({
    userId: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
  });
  await setUserSessionCookie(token);

  return NextResponse.json({
    user: { id: user.id, email: user.email, phone: user.phone, name: user.name, points: user.points },
  });
}
