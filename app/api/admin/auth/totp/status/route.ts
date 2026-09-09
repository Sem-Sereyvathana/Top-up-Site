import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  try {
    const session = await requireAdmin();
    const admin = await prisma.admin.findUnique({
      where: { id: session.adminId },
      select: { totpEnabled: true },
    });
    return NextResponse.json({ enabled: !!admin?.totpEnabled });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
