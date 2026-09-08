import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";

// Admin's own labels for the Accounts marketplace — same idea as
// GameItemCategory for Game Items: independent of the Top-up `Game` list,
// so admin isn't limited to picking from games that already have a full
// Top-up entry (currency, UID label, etc.) just to label an account.

const categorySchema = z.object({
  name: z.string().min(1),
  imageUrl: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
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
  while (await prisma.gameAccountCategory.findUnique({ where: { slug: candidate } })) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

export async function GET() {
  const categories = await prisma.gameAccountCategory.findMany({
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
  const category = await prisma.gameAccountCategory.create({
    data: { ...parsed.data, slug },
  });
  await writeAudit({
    action: "game-account-category.create",
    targetType: "gameAccountCategory",
    targetId: category.id,
  });
  return NextResponse.json(category);
}
