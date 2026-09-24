import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Accept either a full http(s) URL or a local uploaded path like /uploads/xxx.png
const imagePath = z
  .string()
  .min(1)
  .refine(
    (v) => /^https?:\/\//i.test(v) || v.startsWith("/uploads/") || v.startsWith("/"),
    { message: "Must be a URL or uploaded file path" }
  );

const updateSchema = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
  name: z.string().min(1).optional(),
  groupId: z.string().optional().or(z.literal("")),
  publisher: z.string().min(1).optional(),
  description: z.string().optional(),
  imageUrl: imagePath.optional(),
  bannerUrl: imagePath.optional().or(z.literal("")),
  currencyName: z.string().min(1).optional(),
  uidLabel: z.string().optional(),
  uidExample: z.string().optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  deliveryMode: z.enum(["DIRECT", "MANUAL"]).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: {
      products: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(game);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }
  try {
    const game = await prisma.game.update({
      where: { id: params.id },
      data: {
        ...parsed.data,
        ...(parsed.data.groupId !== undefined ? { groupId: parsed.data.groupId || null } : {}),
      },
    });
    return NextResponse.json(game);
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.game.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
