export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runFazerWatch } from "@/lib/fazerWatch";

// Price/stock watcher for FazerCards packs (see lib/fazerWatch.ts).
// Call it every few minutes from a free timer such as cron-job.org:
//   https://YOUR-SITE/api/cron/fazer-watch      with the header
//   Authorization: Bearer <WATCHER_SECRET>
// (Vercel Cron sends the same header when CRON_SECRET is set, so that works too.)

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
  try {
    return NextResponse.json({ ok: true, ...(await runFazerWatch()) });
  } catch (err) {
    console.error("[fazer-watch] failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
