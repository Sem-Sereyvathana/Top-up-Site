export const dynamic = "force-dynamic";

import { clearUserSessionCookie } from "@/lib/userAuth";
import { NextResponse } from "next/server";

export async function POST() {
  await clearUserSessionCookie();
  return NextResponse.json({ ok: true });
}
