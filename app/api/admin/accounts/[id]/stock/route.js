import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { parseAccountStockText } from "@/lib/accountStockParser";
import { requireAdminApi } from "@/lib/auth";

// Lists the credential pool for one account — available units first (what
// the admin can still remove/inspect), then already-sold/assigned ones for
// a record of what went out. Used by the "Auto Top Up" panel on the
// Accounts admin page.
export async function GET(_req, { params }) {
  const { id } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const items = await prisma.gameAccountStockItem.findMany({
    where: { gameAccountId: id },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  const available = items.filter((i) => i.status === "AVAILABLE").length;
  return NextResponse.json({ items, available });
}

const bodySchema = z.object({ text: z.string().min(1) });

// Bulk "Auto Top Up": paste or drop a file of accounts in any of the
// supported shapes (see lib/accountStockParser.ts) and every valid
// username/password pair found becomes its own stock unit. GameAccount.stock
// is kept in lockstep as a cache of how many are AVAILABLE, so the storefront
// and checkout reservation logic (which only ever reads that field) need no
// changes at all.
export async function POST(req, { params }) {
  const { id } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paste or upload some accounts first." }, { status: 400 });
  }

  const account = await prisma.gameAccount.findUnique({ where: { id: id } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const creds = parseAccountStockText(parsed.data.text);
  if (creds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Couldn't find any username/password pairs. Use one per line, e.g. alice@gmail.com:hunter2, or the Username/Email + Password block format.",
      },
      { status: 400 }
    );
  }

  const [, updated] = await prisma.$transaction([
    prisma.gameAccountStockItem.createMany({
      data: creds.map((c) => ({
        gameAccountId: id,
        username: c.username,
        password: c.password,
        notes: c.notes || null,
      })),
    }),
    prisma.gameAccount.update({
      where: { id: id },
      data: { stock: { increment: creds.length } },
    }),
  ]);

  await writeAudit({
    action: "game-account.stock.top-up",
    targetType: "gameAccount",
    targetId: id,
    details: { added: creds.length },
  });

  return NextResponse.json({ added: creds.length, stock: updated.stock });
}
