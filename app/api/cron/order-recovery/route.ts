export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runOrderRecovery } from "@/lib/orderRecovery";

// Order recovery (see lib/orderRecovery.ts): alerts on paid orders stuck in
// PROCESSING and finishes points/stock for orders interrupted by a restart.
//
// Call it every minute from a free timer such as cron-job.org:
//   https://YOUR-SITE/api/cron/order-recovery      with the header
//   Authorization: Bearer <WATCHER_SECRET>
//
// Add ?dry=1 to see what it WOULD do without changing anything or sending
// Telegram messages — use this for the first run.

function authorised(req: NextRequest): boolean {
  const secret = process.env.WATCHER_SECRET || process.env.CRON_SECRET || "";
  if (secret.length < 32) return false; // refuse to run with a missing/weak secret (min 32 chars)
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  try {
    return NextResponse.json({ ok: true, ...(await runOrderRecovery({ dryRun })) });
  } catch (err) {
    console.error("[order-recovery] failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
