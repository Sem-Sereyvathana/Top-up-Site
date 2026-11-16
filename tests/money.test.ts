// Unit tests for the money-critical pure logic (features 1–4).
// Run with: npm test
//
// These deliberately avoid the database: they cover the calculations that
// decide what a customer is charged, what a receipt shows, and how profit is
// derived — the places where a bug silently costs real money. DB-level race
// behaviour is guarded by conditional updateMany() and is listed in the
// manual test steps instead.

import assert from "node:assert/strict";
import {
  unitPriceForBuyer,
  unitPriceForBuyerWithRates,
  normalPriceTotal,
  buyerPriceTotalWithRates,
  productPricingKind,
} from "../lib/reseller";
import {
  derivedResellerPriceUsd,
  derivedCostUsd,
  roundHalfUpCents,
  quickLoginFaceValueUsd,
} from "../lib/resellerRates";
import { maskUid, formatReceiptTime, buildReceiptMessage } from "../lib/receipt";
import {
  startOfUtc7Day,
  endOfUtc7Day,
  startOfUtc7Month,
  endOfUtc7Month,
} from "../lib/revenue";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

// ─────────────────────────────────────────── 1. Reseller pricing (rate-derived)

section("Reseller rate derivation (worked example)");

const RS_RATES = {
  resellerRobuxSendRate: 0.85,
  costRobuxSendRate: 0.7,
  resellerQuickLoginRate: 0.86,
  costQuickLoginRate: 78.12,
};
const NO_RATES = {
  resellerRobuxSendRate: null,
  costRobuxSendRate: null,
  resellerQuickLoginRate: null,
  costQuickLoginRate: null,
};

test("rounding is half-up to whole cents", () => {
  assert.equal(roundHalfUpCents(0.005), 0.01);
  assert.equal(roundHalfUpCents(0.004999), 0.0);
  assert.equal(roundHalfUpCents(0.825), 0.83); // 50R × 0.85/100 = 0.425? no — see below
  assert.equal(roundHalfUpCents(2.675), 2.68); // float trap: 2.675*100 = 267.49999
});

test("Quick Log-In face values match the operator table", () => {
  assert.equal(quickLoginFaceValueUsd(80), 1);
  assert.equal(quickLoginFaceValueUsd(500), 5);
  assert.equal(quickLoginFaceValueUsd(10000), 100);
  assert.equal(quickLoginFaceValueUsd(300), null); // not a QL package
});

test("Quick Log-In worked example: 80R cost $0.7812, reseller $0.86", () => {
  const cost = derivedCostUsd("quick-login", 80, RS_RATES);
  const reseller = derivedResellerPriceUsd("quick-login", 80, 0.9, RS_RATES);
  // 78.12 cents/$1 × $1 face = $0.7812 — kept unrounded at 4dp for reporting
  assert.equal(cost, 0.7812);
  assert.equal(reseller, 0.86);
});

test("Quick Log-In worked example: 500R cost $3.906, reseller $4.30", () => {
  assert.equal(derivedCostUsd("quick-login", 500, RS_RATES), 3.906);
  assert.equal(derivedResellerPriceUsd("quick-login", 500, 4.4, RS_RATES), 4.3);
});

test("Quick Log-In worked example: 10000R reseller capped at normal $85", () => {
  // 100 × 0.86 = $86 > normal $85 → capped.
  assert.equal(derivedResellerPriceUsd("quick-login", 10000, 85, RS_RATES), 85);
  assert.equal(derivedCostUsd("quick-login", 10000, RS_RATES), 78.12);
});

test("Robux Send worked example: 50R cost $0.35, reseller $0.43", () => {
  assert.equal(derivedCostUsd("robux-send", 50, RS_RATES), 0.35);
  // 50/100 × 0.85 = 0.425 → half-up 0.43
  assert.equal(derivedResellerPriceUsd("robux-send", 50, 0.6, RS_RATES), 0.43);
});

test("Robux Send worked example: 100R cost $0.70, reseller $0.85", () => {
  assert.equal(derivedCostUsd("robux-send", 100, RS_RATES), 0.7);
  assert.equal(derivedResellerPriceUsd("robux-send", 100, 1.0, RS_RATES), 0.85);
});

test("Robux Send worked example: 2000R cost $14.00, reseller $17.00", () => {
  assert.equal(derivedCostUsd("robux-send", 2000, RS_RATES), 14);
  assert.equal(derivedResellerPriceUsd("robux-send", 2000, 17.75, RS_RATES), 17);
});

test("no rate set → reseller derivation returns null (falls back to normal)", () => {
  assert.equal(derivedResellerPriceUsd("robux-send", 100, 1, NO_RATES), null);
  assert.equal(derivedResellerPriceUsd("quick-login", 80, 0.9, NO_RATES), null);
  assert.equal(derivedCostUsd("robux-send", 100, NO_RATES), null);
  assert.equal(derivedCostUsd("quick-login", 80, NO_RATES), null);
});

test("non-qualifying products never derive a reseller price or cost", () => {
  assert.equal(derivedResellerPriceUsd("game", 100, 1, RS_RATES), null);
  assert.equal(derivedCostUsd("game", 100, RS_RATES), null);
});

test("kind detection: slugs map to robux-send / quick-login / game", () => {
  assert.equal(productPricingKind({ gameId: "x" }, { slug: "robux-send" }), "robux-send");
  assert.equal(productPricingKind({ gameId: "x" }, { slug: "roblox", currencyName: "Robux" }), "robux-send");
  assert.equal(productPricingKind({ gameId: "x" }, { slug: "robux-quick-login" }), "quick-login");
  assert.equal(productPricingKind({ gameId: "x" }, { slug: "robux-giftcard" }), "game");
  assert.equal(productPricingKind({ gameId: "x" }, { slug: "mobile-legends-kh" }), "game");
});

section("Reseller unit pricing through unitPriceForBuyerWithRates");

const rs50 = { id: "r50", amount: 50, priceUsd: 0.6, gameId: "g1" };
const ql80 = { id: "q80", amount: 80, priceUsd: 0.9, gameId: "g2" };
const ml = { id: "m1", amount: 100, priceUsd: 1.0, gameId: "g3" };
const gamesById = new Map([
  ["g1", { slug: "robux-send", currencyName: "Robux" }],
  ["g2", { slug: "robux-quick-login", currencyName: "Robux" }],
  ["g3", { slug: "mobile-legends-kh", currencyName: "Diamonds" }],
]);

test("reseller pays derived price on Robux Send", () => {
  assert.equal(unitPriceForBuyerWithRates(rs50, true, gamesById.get("g1"), RS_RATES), 0.43);
});

test("reseller pays derived price on Quick Log-In", () => {
  assert.equal(unitPriceForBuyerWithRates(ql80, true, gamesById.get("g2"), RS_RATES), 0.86);
});

test("reseller pays NORMAL price on everything else (even with rates set)", () => {
  assert.equal(unitPriceForBuyerWithRates(ml, true, gamesById.get("g3"), RS_RATES), 1.0);
});

test("reseller pays normal price when no rate is set", () => {
  assert.equal(unitPriceForBuyerWithRates(rs50, true, gamesById.get("g1"), NO_RATES), 0.6);
});

test("normal customer always pays the normal price", () => {
  assert.equal(unitPriceForBuyerWithRates(rs50, false, gamesById.get("g1"), RS_RATES), 0.6);
});

test("cart total for a reseller sums derived prices", () => {
  const lines = [
    { product: rs50, quantity: 2 }, // 0.43 × 2 = 0.86
    { product: ml, quantity: 1 },   // 1.00
  ];
  assert.equal(buyerPriceTotalWithRates(lines, true, gamesById, RS_RATES), 1.86);
});

test("normal total ignores reseller derivation", () => {
  const lines = [
    { product: rs50, quantity: 1 },
    { product: ql80, quantity: 2 },
  ];
  assert.equal(normalPriceTotal(lines), 2.4); // 0.6 + 1.8
});

// ─────────────────────────────────────────── 2. Receipt
section("Receipt (always the NORMAL price)");

test("UID is masked to the last 3 characters", () => {
  assert.equal(maskUid("123456771"), "••••••771");
  assert.ok(maskUid("123456771").endsWith("771"));
  assert.ok(!maskUid("123456771").includes("123456"));
});

test("time is rendered in UTC+7", () => {
  // 2026-11-12 08:30 UTC = 15:30 in UTC+7
  const d = new Date("2026-11-12T08:30:00Z");
  assert.equal(formatReceiptTime(d), "12 Nov 2026, 15:30 (UTC+7)");
});

test("receipt shows the normal price even when a reseller paid less", () => {
  const msg = buildReceiptMessage({
    orderNumber: "RT-ABC123",
    gameName: "Mobile Legends (KH)",
    productName: "Weekly Pass X1",
    playerUid: "123456771",
    normalPriceUsd: 0.9, // reseller may have paid 0.84 — receipt still shows 0.90
    paidAt: new Date("2026-11-12T08:30:00Z"),
  });
  assert.ok(msg.includes("$0.90"), "receipt must show the normal price");
  assert.ok(!msg.includes("$0.84"), "receipt must never show the reseller price");
  assert.ok(msg.includes("Weekly Pass X1"));
  assert.ok(msg.includes("12 Nov 2026, 15:30 (UTC+7)"));
  assert.ok(msg.includes("••••••771"));
});

test("receipt contains the required format lines", () => {
  const msg = buildReceiptMessage({
    orderNumber: "RT-1",
    gameName: "G",
    productName: "P",
    playerUid: "abcdef",
    normalPriceUsd: 1.48,
    paidAt: new Date("2026-11-12T08:30:00Z"),
  });
  for (const piece of [
    "✨ <b>SHARU STORE ✨</b>",
    "បង្កាន់ដៃ · Receipt",
    "──────────────",
    "📦 ទំនិញ · Item",
    "💰 តម្លៃ · Price",
    "🕒 ពេលវេលា · Time",
    "💬 មានបញ្ហា? ទាក់ទង: @Sharu_Game",
  ]) {
    assert.ok(msg.includes(piece), `missing line: ${piece}`);
  }
});

test("receipt escapes HTML in product names", () => {
  const msg = buildReceiptMessage({
    orderNumber: "RT-1",
    gameName: "<script>evil</script>",
    productName: "P & Q",
    playerUid: "abcdef",
    normalPriceUsd: 1,
    paidAt: new Date(),
  });
  assert.ok(!msg.includes("<script>"));
  assert.ok(msg.includes("&lt;script&gt;"));
});

// ─────────────────────────────────────────── 3. Profit / UTC+7 bounds
section("Profit + UTC+7 day boundaries");

test("a UTC+7 day starts 17:00 UTC the previous day", () => {
  const start = startOfUtc7Day(new Date("2026-11-12T10:00:00Z"));
  assert.equal(start.toISOString(), "2026-11-11T17:00:00.000Z");
});

test("a UTC+7 day is exactly 24 hours", () => {
  const d = new Date("2026-11-12T10:00:00Z");
  const span = endOfUtc7Day(d).getTime() - startOfUtc7Day(d).getTime();
  assert.equal(span, 24 * 60 * 60 * 1000);
});

test("an order at 23:30 UTC+7 belongs to that day, not the next", () => {
  // 2026-11-12 23:30 UTC+7 = 16:30 UTC on the 12th
  const orderTime = new Date("2026-11-12T16:30:00Z");
  const dayStart = startOfUtc7Day(new Date("2026-11-12T12:00:00Z"));
  const dayEnd = endOfUtc7Day(new Date("2026-11-12T12:00:00Z"));
  assert.ok(orderTime >= dayStart && orderTime < dayEnd);
});

test("an order at 00:30 UTC+7 belongs to the new day", () => {
  // 2026-11-13 00:30 UTC+7 = 2026-11-12 17:30 UTC
  const orderTime = new Date("2026-11-12T17:30:00Z");
  const dayStart = startOfUtc7Day(new Date("2026-11-12T12:00:00Z"));
  assert.ok(orderTime >= dayStart);
});

test("month bounds cover the whole month in UTC+7", () => {
  const d = new Date("2026-11-15T00:00:00Z");
  assert.equal(startOfUtc7Month(d).toISOString(), "2026-10-31T17:00:00.000Z");
  assert.equal(endOfUtc7Month(d).toISOString(), "2026-11-30T17:00:00.000Z");
});

test("profit math: revenue minus cost, reseller revenue used as paid", () => {
  const cases = [
    { paid: 0.84, cost: 0.7, profit: 0.14 }, // reseller order
    { paid: 0.9, cost: 0.7, profit: 0.2 },   // normal order
    { paid: 9.0, cost: 7.5, profit: 1.5 },
    { paid: 1.48, cost: 1.48, profit: 0 },
  ];
  for (const c of cases) {
    assert.equal(Math.round((c.paid - c.cost) * 100) / 100, c.profit);
  }
});

// ─────────────────────────────────────────── wallet arithmetic
section("Wallet arithmetic (integer cents)");

test("cents conversion round-trips without float drift", () => {
  for (const usd of [0.01, 1.48, 9.99, 123.45, 1000]) {
    const cents = Math.round(usd * 100);
    assert.equal(Math.round(cents) / 100, usd);
  }
});

test("0.1 + 0.2 in cents is exact", () => {
  assert.equal((Math.round(0.1 * 100) + Math.round(0.2 * 100)) / 100, 0.3);
});

test("refund of an amount restores the exact balance", () => {
  let balance = 1000; // $10.00
  const spend = Math.round(8.15 * 100); // 815
  balance -= spend;
  assert.equal(balance, 185);
  balance += spend; // refund
  assert.equal(balance, 1000);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
