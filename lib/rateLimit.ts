import { prisma } from "./prisma";

/**
 * Persistent rate limiter using fixed time windows, backed by the
 * RateLimitBucket table (see prisma/schema.prisma).
 *
 * Replaces the old in-memory Map version, which only tracked counts within
 * a single Node process. On Vercel each request can be served by a
 * different serverless instance with its own empty memory, so the old
 * limiter's "10 attempts per 10 minutes" was really "10 attempts per
 * instance" — an attacker spread across enough invocations could exceed it
 * many times over. Storing the counter in Postgres instead means every
 * instance sees the same count.
 *
 * Uses a single atomic UPSERT (INSERT ... ON CONFLICT DO UPDATE) so
 * concurrent requests for the same key can't race past the limit.
 *
 * @param key      Unique identifier (e.g. `admin-auth:203.0.113.4`)
 * @param max      Maximum requests allowed in the window
 * @param windowMs Window duration in milliseconds
 * @returns        true if the request is allowed, false if rate-limited
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  // Fixed window: all requests within the same windowMs-sized slice of
  // time share one bucket row. Slightly coarser than a true sliding
  // window, but exact, atomic, and cheap — the right tradeoff for
  // anti-brute-force limits like these.
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const bucketKey = `${key}:${windowStart.getTime()}`;

  try {
    const bucket = await prisma.rateLimitBucket.upsert({
      where: { key: bucketKey },
      create: { key: bucketKey, count: 1, windowStart },
      update: { count: { increment: 1 } },
    });

    // Opportunistic cleanup so the table doesn't grow forever — cheap,
    // roughly 1-in-200 requests, no cron/extra infra needed. Anything
    // more than an hour old is well past every window this app uses.
    if (Math.random() < 0.005) {
      const cutoff = new Date(now - 60 * 60 * 1000);
      prisma.rateLimitBucket
        .deleteMany({ where: { windowStart: { lt: cutoff } } })
        .catch(() => {});
    }

    return bucket.count <= max;
  } catch (err) {
    // Fail open: a rate-limit table hiccup shouldn't take down login or
    // registration entirely. This only gates abuse-prevention, not
    // correctness, so availability wins here.
    console.error("[rateLimit] check failed, allowing request:", err);
    return true;
  }
}
