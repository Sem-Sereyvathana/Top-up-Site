import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public endpoint used by components/WelcomePopup.tsx. Returns only the
// fields a visitor needs, and only when the popup is switched on.
//
// It must never break the site: if the WelcomePopup table doesn't exist yet
// (prisma db push not run) or the DB is unreachable, it answers "no popup".
// try/catch (not just .catch) because a stale Prisma client throws
// synchronously when the model is missing.
export async function GET() {
  try {
    const p = await prisma.welcomePopup.findUnique({ where: { id: 1 } });

    const hasContent = !!p && (p.title.trim() || p.body?.trim() || p.imageUrl);
    if (!p || !p.enabled || !hasContent) {
      return NextResponse.json({ popup: null });
    }

    return NextResponse.json({
      popup: {
        version: p.version,
        imageUrl: p.imageUrl || null,
        title: p.title,
        body: p.body || "",
        bullets: (p.bullets || "")
          .split("\n")
          .map((l: string) => l.trim())
          .filter(Boolean),
        // Only ever hand out http(s) links, never javascript: or similar.
        telegramUrl: p.telegramUrl && /^https?:\/\//i.test(p.telegramUrl) ? p.telegramUrl : null,
        buttonLabel: p.buttonLabel || "Join Telegram",
        closeLabel: p.closeLabel || "Close",
      },
    });
  } catch {
    return NextResponse.json({ popup: null });
  }
}
