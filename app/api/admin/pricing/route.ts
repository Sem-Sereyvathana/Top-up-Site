import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { isRobuxGame, isQuickLoginGame, isGiftcardGame } from "@/lib/utils";
import {
  getResellerRates,
  derivedResellerPriceUsd,
  derivedCostUsd,
  clampRate,
  RESELLER_ROBUX_SEND_RATE_MIN,
  RESELLER_ROBUX_SEND_RATE_MAX,
  COST_ROBUX_SEND_RATE_MIN,
  COST_ROBUX_SEND_RATE_MAX,
  RESELLER_QUICK_LOGIN_RATE_MIN,
  RESELLER_QUICK_LOGIN_RATE_MAX,
  COST_QUICK_LOGIN_RATE_MIN,
  COST_QUICK_LOGIN_RATE_MAX,
} from "@/lib/resellerRates";

// "Reseller Rates" admin API (pricing page).
//
// GET  → rates + read-only preview tables for the ONLY two sections the
//        page shows: Robux Send and Quick Log-In. Every other game is not
//        part of reseller pricing at all (resellers pay normal price; cost
//        comes from FazerCards at dispatch).
// PUT  → save the four rates (validated + clamped). "Apply to all" is just
//        the PUT — derived prices are computed from rates on read and at
//        order time, so there is nothing to fan out.
//
// NOTE: normal prices are NEVER touched here. They stay the per-package
// table managed on the Products page.

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const [rates, robuxSendProducts, quickLoginProducts] = await Promise.all([
    getResellerRates(),
    prisma.product.findMany({
      where: { active: true, game: { slug: { in: ["roblox", "robux-send"] } } },
      orderBy: { amount: "asc" },
      select: { id: true, name: true, amount: true, bonus: true, priceUsd: true },
    }),
    prisma.product.findMany({
      where: { active: true, game: { slug: "robux-quick-login" } },
      orderBy: { amount: "asc" },
      select: { id: true, name: true, amount: true, bonus: true, priceUsd: true },
    }),
  ]);

  const round4 = (v: number) => Math.round(v * 10000) / 10000;

  const robuxSend = robuxSendProducts.map((p) => {
    const reseller = derivedResellerPriceUsd("robux-send", p.amount, p.priceUsd, rates);
    const cost = derivedCostUsd("robux-send", p.amount, rates);
    return {
      id: p.id,
      name: p.name,
      amount: p.amount,
      bonus: p.bonus,
      normalPriceUsd: p.priceUsd,
      resellerPriceUsd: reseller,
      costUsd: cost,
      normalProfitUsd: cost === null ? null : round4(p.priceUsd - cost),
      resellerProfitUsd:
        reseller === null || cost === null ? null : round4(reseller - cost),
      // Below cost = selling at a loss — the UI flags this loudly.
      warning:
        cost !== null && (p.priceUsd < cost || (reseller !== null && reseller < cost))
          ? "Sells below your cost"
          : null,
    };
  });

  const quickLogin = quickLoginProducts.map((p) => {
    const reseller = derivedResellerPriceUsd("quick-login", p.amount, p.priceUsd, rates);
    const cost = derivedCostUsd("quick-login", p.amount, rates);
    return {
      id: p.id,
      name: p.name,
      amount: p.amount,
      bonus: p.bonus,
      normalPriceUsd: p.priceUsd,
      resellerPriceUsd: reseller,
      costUsd: cost,
      normalProfitUsd: cost === null ? null : round4(p.priceUsd - cost),
      resellerProfitUsd:
        reseller === null || cost === null ? null : round4(reseller - cost),
      warning:
        cost !== null && (p.priceUsd < cost || (reseller !== null && reseller < cost))
          ? "Sells below your cost"
          : null,
    };
  });

  return NextResponse.json({
    rates,
    limits: {
      resellerRobuxSend: { min: RESELLER_ROBUX_SEND_RATE_MIN, max: RESELLER_ROBUX_SEND_RATE_MAX },
      costRobuxSend: { min: COST_ROBUX_SEND_RATE_MIN, max: COST_ROBUX_SEND_RATE_MAX },
      resellerQuickLogin: { min: RESELLER_QUICK_LOGIN_RATE_MIN, max: RESELLER_QUICK_LOGIN_RATE_MAX },
      costQuickLogin: { min: COST_QUICK_LOGIN_RATE_MIN, max: COST_QUICK_LOGIN_RATE_MAX },
    },
    robuxSend,
    quickLogin,
  });
}

const putSchema = z.object({
  resellerRobuxSendRate: z.number().nullable().optional(),
  costRobuxSendRate: z.number().nullable().optional(),
  resellerQuickLoginRate: z.number().nullable().optional(),
  costQuickLoginRate: z.number().nullable().optional(),
});

export async function PUT(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const clampOrNull = (
    v: number | null | undefined,
    min: number,
    max: number
  ): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return clampRate(v, min, max);
  };

  const nextRates = {
    ...(clampOrNull(
      data.resellerRobuxSendRate,
      RESELLER_ROBUX_SEND_RATE_MIN,
      RESELLER_ROBUX_SEND_RATE_MAX
    ) !== undefined
      ? {
          resellerRobuxSendRate: clampOrNull(
            data.resellerRobuxSendRate,
            RESELLER_ROBUX_SEND_RATE_MIN,
            RESELLER_ROBUX_SEND_RATE_MAX
          ),
        }
      : {}),
    ...(clampOrNull(
      data.costRobuxSendRate,
      COST_ROBUX_SEND_RATE_MIN,
      COST_ROBUX_SEND_RATE_MAX
    ) !== undefined
      ? {
          costRobuxSendRate: clampOrNull(
            data.costRobuxSendRate,
            COST_ROBUX_SEND_RATE_MIN,
            COST_ROBUX_SEND_RATE_MAX
          ),
        }
      : {}),
    ...(clampOrNull(
      data.resellerQuickLoginRate,
      RESELLER_QUICK_LOGIN_RATE_MIN,
      RESELLER_QUICK_LOGIN_RATE_MAX
    ) !== undefined
      ? {
          resellerQuickLoginRate: clampOrNull(
            data.resellerQuickLoginRate,
            RESELLER_QUICK_LOGIN_RATE_MIN,
            RESELLER_QUICK_LOGIN_RATE_MAX
          ),
        }
      : {}),
    ...(clampOrNull(
      data.costQuickLoginRate,
      COST_QUICK_LOGIN_RATE_MIN,
      COST_QUICK_LOGIN_RATE_MAX
    ) !== undefined
      ? {
          costQuickLoginRate: clampOrNull(
            data.costQuickLoginRate,
            COST_QUICK_LOGIN_RATE_MIN,
            COST_QUICK_LOGIN_RATE_MAX
          ),
        }
      : {}),
  };

  await prisma.settings.upsert({
    where: { id: 1 },
    update: nextRates,
    create: { id: 1, ...nextRates },
  });

  await writeAudit({
    action: "reseller-rates.update",
    targetType: "settings",
    targetId: "1",
    details: Object.entries(nextRates)
      .map(([k, v]) => `${k}=${v === null ? "cleared" : v}`)
      .join(", "),
  });

  return NextResponse.json({ ok: true, rates: await getResellerRates() });
}
