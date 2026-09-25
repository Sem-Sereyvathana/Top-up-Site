import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public endpoint used by components/SignInPopup.tsx. Returns the admin's
// custom message only when it's switched on and has something to show;
// otherwise { popup: null } and the component uses its built-in default.
//
// It must never break the sign-in gate: if the SignInPopup table doesn't
// exist yet (prisma db push not run) or the DB is unreachable, it answers
// "no custom popup". try/catch (not just .catch) because a stale Prisma
// client throws synchronously when the model is missing.
export async function GET() {
  try {
    const p = await prisma.signInPopup.findUnique({ where: { id: 1 } });

    const hasContent = !!p && (p.title.trim() || p.body?.trim() || p.imageUrl);
    if (!p || !p.enabled || !hasContent) {
      return NextResponse.json({ popup: null });
    }

    return NextResponse.json({
      popup: {
        imageUrl: p.imageUrl || null,
        title: p.title,
        body: p.body || "",
        bullets: (p.bullets || "")
          .split("\n")
          .map((l: string) => l.trim())
          .filter(Boolean),
        closeLabel: p.closeLabel || "Not now",
      },
    });
  } catch {
    return NextResponse.json({ popup: null });
  }
}
