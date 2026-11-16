import { packLinesFor } from "../lib/fulfillment";
import { partsFor } from "../lib/fazercards";

// Sanity-check the multi-pack expansion used by the giftcard cart: the
// same flattening runFazerParts does, without touching FazerCards.
function expand(order: any, products: Map<string, { supplierOfferId: string | null }>) {
  const lines = packLinesFor(order, products);
  const parts: any[] = [];
  for (const line of lines) {
    if (!line.supplierOfferId) throw new Error("line without offer");
    const lineParts = partsFor("roblox_id", line.supplierOfferId);
    for (let q = 0; q < line.quantity; q++) parts.push(...lineParts);
  }
  return parts;
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name}\n      got ${a}\n      want ${e}`); }
}

const products = new Map<string, { supplierOfferId: string | null }>([
  ["rc_279", { supplierOfferId: "roblox_id:50000_idr" }],
  ["rc_362", { supplierOfferId: "roblox_id:65000_idr" }],
  ["rc_557", { supplierOfferId: "roblox_id:100000_idr" }],
]);

console.log("Multi-pack giftcard cart:");
check(
  "2x 279R + 1x 362R -> 3 gift-card purchases",
  expand(
    {
      product: { supplierOfferId: "roblox_id:50000_idr" },
      items: [
        { productId: "rc_279", quantity: 2 },
        { productId: "rc_362", quantity: 1 },
      ],
    },
    products
  ),
  [
    { kind: "giftcard", category: "roblox_id", cardId: "50000_idr" },
    { kind: "giftcard", category: "roblox_id", cardId: "50000_idr" },
    { kind: "giftcard", category: "roblox_id", cardId: "65000_idr" },
  ]
);

console.log("Single-package order (no items):");
check(
  "falls back to the primary product",
  expand({ product: { supplierOfferId: "roblox_id:100000_idr" } }, products),
  [{ kind: "giftcard", category: "roblox_id", cardId: "100000_idr" }]
);

console.log("Top-up bundle spec still expands:");
check(
  "2x weekly_pass",
  partsFor("mobile_legends", "2x weekly_pass").map((p) => (p as { kind: "topup"; offerId: string }).offerId),
  ["weekly_pass", "weekly_pass"]
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
