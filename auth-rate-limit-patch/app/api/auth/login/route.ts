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

const loginSchema = z.object({
  identifier: z.string().min(3).max(120),
  password: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  // 10 attempts per 10 minutes per IP — slows brute-forcing without
  // blocking a normal user who mistypes their password a couple times.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`login:${ip}`, 10, 10 * 60 * 1000)) {
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

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: lookupValue }, { phone: lookupValue }] },
  });

  // Same generic error whether the account doesn't exist or the password is
  // wrong, so we don't leak which emails/phones are registered.
  const invalid = () =>
    NextResponse.json({ error: "Incorrect email/phone or password" }, { status: 401 });

  if (!user || !user.active) return invalid();

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) return invalid();

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
