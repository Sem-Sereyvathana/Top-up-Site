import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{  id: string  }> }
) {
  const { id } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();

    let applicableProductId: string | null | undefined;
    if (body.applicableProductId !== undefined) {
      const next =
        typeof body.applicableProductId === "string" && body.applicableProductId.trim()
          ? body.applicableProductId.trim()
          : null;
      if (next) {
        const product = await prisma.product.findUnique({ where: { id: next } });
        if (!product) {
          return NextResponse.json(
            { error: "The selected package no longer exists" },
            { status: 400 }
          );
        }
      }
      applicableProductId = next;
    }

    const promo = await prisma.promoCode.update({
      where: { id: id },
      data: {
        ...(typeof body.active === "boolean" ? { active: body.active } : {}),
        ...(typeof body.maxUses === "number" ? { maxUses: body.maxUses } : {}),
        ...(body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
          : {}),
        ...(applicableProductId !== undefined ? { applicableProductId } : {}),
      },
    });
    return NextResponse.json(promo);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{  id: string  }> }
) {
  const { id } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  try {
    await prisma.promoCode.delete({ where: { id: id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
