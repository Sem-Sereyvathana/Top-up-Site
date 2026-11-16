import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { lookupGameId } from "@/lib/uidLookup";
import { regionRuleFor, regionAllowed } from "@/lib/regionRules";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

const bodySchema = z.object({
  gameSlug: z.string().min(1).max(60),
  uid: z.string().regex(/^\d{5,20}$/, "UID must be 5–20 digits"),
  server: z.string().regex(/^\d{1,6}$/).optional(),
});

export async function POST(req: NextRequest) {
  // â”€â”€ rate limit: 10 req / min per IP â”€â”€
  const ip =
    getClientIp(req);
  if (!(await checkRateLimit(`uid-lookup:${ip}`, 10, 60_000))) {
    return NextResponse.json(
      { nickname: null, verified: false, error: "Too many requests — try again shortly" },
      { status: 429 },
    );
  }

  // â”€â”€ parse body â”€â”€
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { nickname: null, verified: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        nickname: null,
        verified: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      },
      { status: 400 },
    );
  }

  const { gameSlug, uid, server } = parsed.data;

  // Nickname / existence check (FazerCards first, then the free community
  // fallbacks — see lib/uidLookup.ts).
  const result = await lookupGameId(gameSlug, uid, server);

  // Region gate: FazerCards reports the account's region on a successful
  // check. If this store doesn't sell that region for this game, say so
  // BEFORE the buyer pays (FazerCards would otherwise charge us, refund our
  // balance, and leave the customer's money with us).
  const rule = regionRuleFor(gameSlug);
  const region = result.status === "verified" ? result.region ?? null : null;
  const allowed = regionAllowed(rule, region);

  return NextResponse.json({
    nickname: result.status === "verified" ? result.name : null,
    verified: result.status === "verified",
    status: result.status,
    // Account region as reported by the checker (null when unknown).
    region,
    // null = not gated (no rule for this game, or region unknown) → the
    // client must not block. true/false = the definitive verdict.
    regionAllowed: allowed,
    // What this store sells for the game, for the message shown on a block.
    regionLabel: rule?.label ?? null,
    allowedRegions: rule?.allowedRegions ?? null,
    // Present on blocklist rules (e.g. Mobile Legends Global): the regions
    // that have their OWN dedicated pack and must buy that instead. Every
    // region not listed here is served by the pack.
    blockedRegions: rule?.blockedRegions ?? null,
  });
}
