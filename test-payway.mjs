// One-off script to confirm your PayWay sandbox credentials actually work.
// Run locally with:
//   PAYWAY_MERCHANT_ID=xxx PAYWAY_API_KEY=xxx node test-payway.mjs
// (or `node --env-file=.env test-payway.mjs` on Node 20.6+)
//
// Previously had real credentials hardcoded here, which meant they were
// committed to git history — rotate that old key in your PayWay dashboard
// even though this script is now fixed, since the old value is still
// readable in past commits.
import crypto from "crypto";

const MERCHANT_ID = process.env.PAYWAY_MERCHANT_ID;
const API_KEY = process.env.PAYWAY_API_KEY;
const BASE = process.env.PAYWAY_BASE_URL || "https://checkout-sandbox.payway.com.kh";

if (!MERCHANT_ID || !API_KEY) {
  console.error("Set PAYWAY_MERCHANT_ID and PAYWAY_API_KEY env vars before running this script.");
  process.exit(1);
}

function reqTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}
const b64 = (s) => Buffer.from(s, "utf-8").toString("base64");
const hmac512 = (input, key) => crypto.createHmac("sha512", key).update(input, "utf-8").digest("base64");

async function main() {
  const req_time = reqTime();
  const tran_id = "TEST-" + Date.now().toString().slice(-8);
  const amount = "0.10";
  const items = b64(JSON.stringify([{ name: "Test item", quantity: 1, price: 0.1 }]));
  const currency = "USD";
  const payment_option = "abapay_khqr_deeplink";
  const type = "purchase";

  // Same field order lib/payment.ts uses, with every optional field empty.
  const toHash =
    req_time + MERCHANT_ID + tran_id + amount + items + "" + "" + "" + "" + "" +
    type + payment_option + "" + "" + "" + "" + currency + "" + "" + "" + "" + "" + "" + "";
  const hash = hmac512(toHash, API_KEY);

  const form = new FormData();
  form.set("req_time", req_time);
  form.set("merchant_id", MERCHANT_ID);
  form.set("tran_id", tran_id);
  form.set("amount", amount);
  form.set("items", items);
  form.set("currency", currency);
  form.set("type", type);
  form.set("payment_option", payment_option);
  form.set("hash", hash);

  const res = await fetch(`${BASE}/api/payment-gateway/v1/payments/purchase`, {
    method: "POST",
    body: form,
  });
  const text = await res.text();
  console.log("HTTP", res.status);
  console.log(text.slice(0, 1500));
}

main();
