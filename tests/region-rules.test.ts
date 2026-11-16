// Unit tests for the pre-purchase region gate (lib/regionRules.ts).
// Run with: npm test
//
// This logic decides whether a buyer is stopped BEFORE paying. Getting it
// wrong in the permissive direction costs a manual refund (FazerCards charges
// us, refunds our balance, and the customer's money stays with us); getting
// it wrong in the restrictive direction silently loses sales. So both the
// blocklist (Mobile Legends Global) and allowlist (Free Fire) behaviours are
// pinned here.
import assert from "node:assert/strict";
import {
  regionRuleFor,
  regionAllowed,
  regionScopeDescription,
} from "../lib/regionRules";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message}`);
  }
}

console.log("Mobile Legends Global (blocklist mode):");
const ml = regionRuleFor("mobile-legends-kh");

test("has a rule", () => {
  assert.ok(ml);
  assert.equal(ml!.allowedRegions, undefined, "blocklist rule must not carry an allowlist");
  assert.ok(ml!.blockedRegions && ml!.blockedRegions.length > 0);
});

test("Cambodia is allowed (verified with a real account)", () => {
  assert.equal(regionAllowed(ml, "Cambodia"), true);
});

test("regions with no dedicated pack are allowed", () => {
  for (const r of ["Vietnam", "Thailand", "Laos", "Myanmar", "Bhutan"]) {
    assert.equal(regionAllowed(ml, r), true, `${r} should be allowed`);
  }
});

test("regions with their own dedicated pack are blocked", () => {
  for (const r of [
    "Indonesia",
    "ID",
    "Malaysia",
    "MY",
    "Singapore",
    "SG",
    "Philippines",
    "PH",
    "Brazil",
    "BR",
    "Turkey",
    "TR",
    "Russia",
    "RU",
    "United States",
    "US",
  ]) {
    assert.equal(regionAllowed(ml, r), false, `${r} should be blocked`);
  }
});

test("comparison is case-insensitive and trimmed", () => {
  assert.equal(regionAllowed(ml, "  indonesia "), false);
  assert.equal(regionAllowed(ml, "  vietnam "), true);
});

test("unknown region never blocks (fails open)", () => {
  assert.equal(regionAllowed(ml, null), null);
  assert.equal(regionAllowed(ml, undefined), null);
  assert.equal(regionAllowed(ml, "   "), null);
});

test("scope description reads as a blocklist", () => {
  const desc = regionScopeDescription(ml!);
  assert.ok(desc.startsWith("every region except "), desc);
  assert.ok(desc.includes("Indonesia"), desc);
});

console.log("Free Fire MY/SG (blocklist mode):");
const ff = regionRuleFor("free-fire-kh");

test("has a blocklist and no allowlist", () => {
  assert.ok(ff);
  assert.equal(ff!.allowedRegions, undefined);
  assert.ok(ff!.blockedRegions && ff!.blockedRegions.length > 0);
});

test("Cambodia is allowed on the MY/SG pack", () => {
  assert.equal(regionAllowed(ff, "Cambodia"), true);
});

test("regions without a dedicated FF pack are allowed", () => {
  for (const r of ["Cambodia", "Laos", "Myanmar", "Nepal"]) {
    assert.equal(regionAllowed(ff, r), true, `${r} should be allowed`);
  }
});

test("MY and SG are allowed — they are the pack's own server group", () => {
  for (const r of ["MY", "SG", "my", " sg "]) {
    assert.equal(regionAllowed(ff, r), true, `${r} should be allowed`);
  }
});

test("regions with a dedicated FF pack are blocked", () => {
  for (const r of [
    "CIS",
    "MENA",
    "LATAM",
    "Bangladesh",
    "BD",
    "Brazil",
    "BR",
    "EU",
    "Indonesia",
    "ID",
    "Philippines",
    "PH",
    "Thailand",
    "TH",
    "Taiwan",
    "TW",
    "Vietnam",
    "VN",
  ]) {
    assert.equal(regionAllowed(ff, r), false, `${r} should be blocked`);
  }
});

test("blocklist comparison is case-insensitive and trimmed", () => {
  assert.equal(regionAllowed(ff, "  vietnam "), false);
  assert.equal(regionAllowed(ff, "  cambodia "), true);
});

test("scope description reads as a blocklist", () => {
  const desc = regionScopeDescription(ff!);
  assert.ok(desc.startsWith("every region except "), desc);
  assert.ok(desc.includes("Vietnam"), desc);
});

console.log("Ungated games and regionAllowed(null):");

test("a game with no rule is not gated", () => {
  assert.equal(regionRuleFor("valorant-kh"), null);
  assert.equal(regionAllowed(null, "anything"), null);
});

if (failures > 0) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
