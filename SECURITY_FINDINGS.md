# Security Review — Sharustore Top-up Site

**Scope:** static code review of the current working tree (not a live penetration test).
**Verdict:** ⚠️ **NOT SAFE TO DEPLOY YET.** Two configuration problems alone would either let anyone forge an admin login or silently break all payment confirmation. Both are quick fixes. Details below.

Ordered most severe first.

---

## 🔴 CRITICAL 1 — `JWT_SECRET` is still the example placeholder

**File:** `.env` (not committed — good), `lib/auth.ts:24-30`, `lib/userAuth.ts:9-15`

The value in `.env` still contains the `change-this-to-a-long-random-string...` placeholder text (length 53 but not random). This single secret signs **both admin session tokens and customer session tokens**.

**Exploitation:** anyone who reads `.env.example` (it's in the repo) knows the exact secret. They can mint their own `{type:"session", adminId:...}` JWT and get full admin access to orders, customers, settings, and stock — no password, no 2FA.

**Fix:** generate a real random secret and set it only in the host's env vars:
```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Rotating it logs everyone out — expected.

---

## 🔴 CRITICAL 2 — `KHPAY_WEBHOOK_SECRET` is empty

**Files:** `.env`, `lib/payment.ts:190-194`

`verifyWebhook()` returns `false` when the secret is missing, so **every real payment webhook is rejected with 401**. A customer pays real money, the gateway fires `payment.paid`, the server refuses it, and the order sits `PENDING` forever — no delivery, no points, no Telegram alert. The customer has paid and received nothing.

**Fix:** set `KHPAY_WEBHOOK_SECRET` to the exact signing secret shown in the KHPay dashboard, then confirm one real test payment flips an order to PAID.

---

## 🔴 CRITICAL 3 — `PAYMENT_SIMULATION_MODE=true` is still set

**Files:** `.env`, `lib/simMode.ts`, `lib/payment.ts:188`, `app/api/payment/simulate/route.ts`

`isSimulationMode()` correctly ignores the flag when `NODE_ENV === "production"` — `next start` sets that, so a normal deploy is safe. But this is a loaded gun:

- In simulation mode `verifyWebhook()` returns `true` for **any** request → anyone can POST a fake `payment.paid` and get free orders.
- `GET /api/payment/simulate?order=<ANY_ORDER>` publicly marks any PENDING order paid and delivered — including `GI-` and `AC-` marketplace orders.

If the app is ever run as `next dev`, under PM2/custom node without `NODE_ENV=production`, or behind a host that doesn't set it, both of those go live.

**Fix:** delete the line from production env. Also consider making `isSimulationMode()` require an explicit `ALLOW_PAYMENT_SIMULATION=1` *and* `NODE_ENV !== production`.

---

## 🟠 HIGH 1 — Client can set an order's `paymentRef`

**File:** `app/api/orders/[orderNumber]/route.ts:17-30, 145-151`

The PATCH endpoint (used by the checkout page) lets the buyer write an arbitrary `transactionId` into `paymentRef`. The webhook then compares `data.transaction_id` against it (`lib/payment.ts` route lines 111-115) and, if `paymentRef` is absent, falls back to `findFirst({ where: { paymentRef: transactionId } })`.

Because the webhook itself is HMAC-signed this is not directly exploitable by an outsider, but it lets a buyer make the transaction-ID cross-check meaningless — set `paymentRef` to the ID of a different (cheaper) transaction and the `txOk` guard can be satisfied. Amount is still checked, so impact is limited, but this field should not be customer-writable.

**Fix:** have the server generate/verify `paymentRef`; if the browser must store one, store it in a separate `clientPaymentRef` column that the webhook never trusts.

---

## 🟠 HIGH 2 — Stock can go negative under concurrent orders

**Files:** `lib/stock.ts:98-121`, `app/api/orders/route.ts:161-183`

The stock pre-check happens *before* the order is created, and the decrement is an unguarded `{ decrement: n }`. Two simultaneous checkouts for the last unit both pass the pre-check and both decrement → stock `-1`. The same applies to `robuxStock.totalRobux`, which has **no** `gte` guard at all.

**Fix:** use a conditional write, mirroring what the promo/points code already does:
```ts
const res = await tx.product.updateMany({
  where: { id, stock: { gte: qty } },
  data: { stock: { decrement: qty } },
});
if (res.count !== 1) throw new Error("STOCK_GONE");
```
and the same with `totalRobux: { gte: robuxAmount }`. Wrap in the order transaction so a failure rolls the order back.

---

## 🟠 HIGH 3 — Rate-limit IP source is unverified for your deployment

**File:** `lib/clientIp.ts`

The code takes the **last** `x-forwarded-for` entry, trusting that the edge proxy appends the real client IP last. That is correct for a long proxy chain but is **wrong for the common Vercel case**, where Vercel supplies the client IP and the app sees a single-entry header. The file's own comment says "NOTE (to verify on the live Render service)".

If it's wrong, either every visitor shares one bucket (you rate-limit your own customers into errors) or a spoofed header sidesteps every IP limit — including login brute-force and promo-code brute-force that already have strict limits.

**Fix:** before launch, hit a diagnostic route and log all of `cf-connecting-ip`, `true-client-ip`, `x-forwarded-for` from a real request through your host, and pin the code to the header your host actually guarantees.

---

## 🟡 MEDIUM 1 — No CSRF tokens on admin mutations

**Files:** all `app/api/admin/**` POST/PATCH/DELETE, `lib/auth.ts:63-71`

Cookies are `SameSite=Lax`, which blocks cross-site POST/PATCH — the main CSRF vector is closed. But there's no origin check or token as defence-in-depth, and Lax still sends cookies on top-level GET navigations. Nothing found that mutates state over GET, so this is currently theoretical.

**Fix (cheap):** reject admin mutations whose `Origin` header isn't your own domain.

---

## 🟡 MEDIUM 2 — Banlist is only checked at order creation

**Files:** `app/api/orders/route.ts:95-112`, `app/api/auth/register/route.ts`, `app/api/auth/login/route.ts`

Banned emails/phones/IPs/UIDs are blocked at checkout, but a banned person can still register, log in, chat, and browse. The ban therefore costs them no account — only the final order attempt.

**Fix:** add the same `blockedIdentity` lookup to register and login.

---

## 🟢 LOW 1 — Admin-editable blog content uses `dangerouslySetInnerHTML`

**File:** `app/blog/[slug]/page.tsx:40`

`block.replace(/\n/g, "<br/>")` injects raw HTML. Only admins can author blog blocks, so this is self-XSS unless an admin account is compromised. The CSP from `middleware.ts` (nonce + `strict-dynamic`) blocks inline `<script>`, so the blast radius is markup injection, not script execution.

**Fix (optional):** render newlines as CSS `white-space: pre-wrap` instead.

---

## 🟢 LOW 2 — `ADMIN_EMAIL` / `ADMIN_PASSWORD` live in `.env`

If the seed script is ever run against production it will reset the admin password to these known values.

**Fix:** remove them from the production environment after the first seed, or make the seed refuse to run when `NODE_ENV === "production"`.

---

## ✅ What's already done well

- **Server-side price authority:** `amountUsd` is always recomputed from DB `priceUsd` in top-up, game-item and account order routes. The client cannot name its own price.
- **Webhook HMAC:** `timingSafeEqual` comparison of `sha256=<hex>` over the raw body. Correctly written.
- **Webhook idempotency:** `finalizeOrderAfterPayment` uses an atomic `updateMany({where:{status:"PENDING"}})` claim; duplicate webhook deliveries return `skipped`. Points (`pointsAwarded`) and stock (`stockDecremented`) use the same claim pattern.
- **Webhook amount check:** paid amount must match `order.amountUsd` within $0.01, currency must be USD, mismatch triggers a Telegram alert and does **not** mark paid.
- **Admin auth:** bcrypt password hashing, DB-backed lockout (5 attempts / 15 min), optional TOTP with single-use hashed backup codes, `type` claim separates 2FA-pending tokens from real sessions, `requireAdminApi()` re-checks the admin is still active in the DB on every request.
- **Middleware + per-route double gate:** every `/api/admin/*` route verified to call `requireAdminApi()` (the only two exceptions are the login routes themselves, and the TOTP setup/status routes use `requireAdmin()` internally).
- **IDOR protection:** order detail, retry-payment, and invoice routes all enforce that the requester owns the order (`order.userId === user.id`), returning 404 rather than 403 so order existence isn't leaked.
- **Rate limiting** is Postgres-backed (works across serverless instances) and atomic via UPSERT, with `failClosed` on every security-sensitive route.
- **Promo codes** are re-validated server-side at order time, with an atomic usage counter and a cap that prevents a restricted coupon discounting more than its matching line.
- **`.env` is gitignored** and untracked — no secrets in git history.
- **CSP** with per-request nonce and `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`.
- **Upload route** is admin-gated, 5 MB cap, MIME whitelist, uploaded to Cloudinary with the API secret server-side only.
- **Google OAuth** validates `state` against a cookie (CSRF on the callback is covered).

---

## Recommended fix order before launch

1. Real random `JWT_SECRET` (CRITICAL 1)
2. Set `KHPAY_WEBHOOK_SECRET` (CRITICAL 2)
3. Remove `PAYMENT_SIMULATION_MODE` from production (CRITICAL 3)
4. Guard stock decrements with `gte` conditions (HIGH 2)
5. Verify the client-IP header on your real host (HIGH 3)
6. Stop accepting client-supplied `paymentRef` (HIGH 1)
7. Add `Origin` check to admin mutations (MEDIUM 1)
8. Extend banlist to register/login (MEDIUM 2)

After 1–3, run one **real** end-to-end test payment of a small amount and confirm: order flips PENDING → PAID, stock decrements once, points are credited once, and a duplicate webhook replay does nothing.
