import crypto from "crypto";

// The payload the Telegram Login Widget sends back after a user authorizes.
// See: https://core.telegram.org/widgets/login
export interface TelegramAuthPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

// How old an auth payload is allowed to be before we reject it. This keeps
// someone from replaying a captured payload indefinitely — 1 day is
// generous enough for clock drift/slow networks but not much else.
const MAX_AUTH_AGE_SECONDS = 60 * 60 * 24;

/**
 * Verifies that a Telegram Login Widget payload was genuinely signed by
 * Telegram for *our* bot, and hasn't expired.
 *
 * Per Telegram's docs: the secret key is SHA256(bot_token), and the hash
 * field is an HMAC-SHA256 of all the other fields (sorted, "key=value"
 * joined by "\n") signed with that secret key.
 */
export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string
): { valid: boolean; reason?: string } {
  const { hash, ...rest } = payload;
  if (!hash) return { valid: false, reason: "Missing hash" };

  const dataCheckString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${(rest as any)[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time comparison to avoid timing attacks.
  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "Signature mismatch" };
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - payload.auth_date;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) {
    return { valid: false, reason: "Auth payload expired" };
  }

  return { valid: true };
}
