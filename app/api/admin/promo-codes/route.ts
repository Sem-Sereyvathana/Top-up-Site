import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";

const createSchema = z.object({
  code: z.string().min(2).max(30).transform((v) => v.toUpperCase().trim()),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.number().positive(),
  minOrderUsd: z.number().min(0).default(0),
  maxUses: z.number().int().min(0).default(0),
  expiresAt: z.string().nullable().optional(),
  active: z.boolean().default(true),
  // Optional package restriction — coupon only works when this exact product
  // is in the order. Empty/absent = works on any product, any game.
  applicableProductId: z.string().nullable().optional(),
});

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const codes = await prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      applicableProduct: {
        select: {
          id: true,
          name: true,
          game: { select: { name: true, slug: true } },
        },
      },
    },
  });
  return NextResponse.json(codes);
}

export async function POST(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const existing = await prisma.promoCode.findUnique({ where: { code: data.code } });
    if (existing) {
      return NextResponse.json({ error: "Code already exists" }, { status: 409 });
    }

    const applicableProductId = data.applicableProductId?.trim() || null;
    if (applicableProductId) {
      const product = await prisma.product.findUnique({
        where: { id: applicableProductId },
      });
      if (!product) {
        return NextResponse.json(
          { error: "The selected package no longer exists" },
          { status: 400 }
        );
      }
    }

    const promo = await prisma.promoCode.create({
      data: {
        code: data.code,
        discountType: data.discountType,
        discountValue: data.discountValue,
        minOrderUsd: data.minOrderUsd,
        maxUses: data.maxUses,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        active: data.active,
        applicableProductId,
      },
    });

    return NextResponse.json(promo, { status: 201 });
  } catch (err) {
    console.error("Promo create error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
