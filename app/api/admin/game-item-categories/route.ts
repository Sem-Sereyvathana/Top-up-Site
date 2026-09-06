import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";

const categorySchema = z.object({
  name: z.string().min(1),
  imageUrl: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
  deliveryMode: z.enum(["DIRECT", "MANUAL"]).default("DIRECT"),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "category";
  let candidate = root;
  let n = 2;
  while (await prisma.gameItemCategory.findUnique({ where: { slug: candidate } })) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

export async function GET() {
  const categories = await prisma.gameItemCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = categorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const slug = await uniqueSlug(parsed.data.name);
  const category = await prisma.gameItemCategory.create({
    data: { ...parsed.data, slug },
  });
  await writeAudit({
    action: "game-item-category.create",
    targetType: "gameItemCategory",
    targetId: category.id,
  });
  return NextResponse.json(category);
}
