import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import {
  createUserSession,
  setUserSessionCookie,
  hashPassword,
  isEmail,
  isPhone,
  normalizePhone,
} from "@/lib/userAuth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

const registerSchema = z.object({
  identifier: z.string().min(3).max(120), // email or phone
  password: z.string().min(6).max(100),
  name: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const ipAddress = getClientIp(req);

  // 5 new accounts per hour per IP — enough for a real household, tight
  // enough to make mass fake-account creation impractical.
  if (!(await checkRateLimit(`register:${ipAddress}`, 5, 60 * 60 * 1000, { failClosed: true }))) {
    return NextResponse.json(
      { error: "Too many accounts created from this connection. Please try again later." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const identifier = parsed.data.identifier.trim();
  const asEmail = isEmail(identifier);
  const asPhone = !asEmail && isPhone(identifier);

  if (!asEmail && !asPhone) {
    return NextResponse.json(
      { error: "Enter a valid email address or phone number" },
      { status: 400 }
    );
  }

  const email = asEmail ? identifier.toLowerCase() : null;
  const phone = asPhone ? normalizePhone(identifier) : null;

  // Banlist: a blocked email/phone/IP must not be able to create an account.
  const banCandidates = [
    { type: "email", value: email },
    { type: "phone", value: phone },
    { type: "ip", value: ipAddress.toLowerCase() },
  ].filter((c): c is { type: string; value: string } => !!c.value);
  if (banCandidates.length > 0) {
    const blocked = await prisma.blockedIdentity.findFirst({
      where: { OR: banCandidates.map((c) => ({ type: c.type, value: c.value })) },
    });
    if (blocked) {
      return NextResponse.json(
        { error: "This account cannot be created. Contact support if you believe this is a mistake." },
        { status: 403 }
      );
    }
  }

  // Account-level limit: 3 registration attempts per identifier per hour,
  // counted atomically. Stops an attacker rotating IPs to retry the same
  // email/phone (e.g. to race the "already exists" check or spam a victim's
  // inbox). Temporary window, resets on its own.
  const idKey = `register-id:${email ?? phone}`;
  if (!(await checkRateLimit(idKey, 3, 60 * 60 * 1000, { failClosed: true }))) {
    return NextResponse.json(
      { error: "Too many attempts for this email/phone. Please try again later." },
      { status: 429 }
    );
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email/phone already exists" },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: {
      email,
      phone,
      passwordHash,
      name: parsed.data.name,
      lastLoginAt: new Date(),
    },
  });

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
