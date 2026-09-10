import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public counterpart to /api/admin/settings — no auth required, but only
// returns fields that are safe to expose to every visitor. Used by
// components/Header.tsx to show the admin-configured logo.
export async function GET() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } }).catch(() => null);
  return NextResponse.json({ logoUrl: settings?.logoUrl ?? null });
}
