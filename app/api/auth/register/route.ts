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

const registerSchema = z.object({
  identifier: z.string().min(3).max(120), // email or phone
  password: z.string().min(6).max(100),
  name: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  // 5 new accounts per hour per IP — enough for a real household, tight
  // enough to make mass fake-account creation impractical.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000))) {
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
