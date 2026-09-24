import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public counterpart to /api/admin/settings — no auth required, but only
// returns fields that are safe to expose to every visitor. Used by
// components/Header.tsx and components/Footer.tsx for the admin-configured
// logo, site name and support Telegram.
export async function GET() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } }).catch(() => null);
  return NextResponse.json({
    logoUrl: settings?.logoUrl ?? null,
    siteName: settings?.siteName ?? null,
    supportTelegram: settings?.supportTelegram ?? null,
  });
}
