import { createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Cached across invocations so we're not re-fetching Google's public keys
// on every login.
const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));

export interface GoogleProfile {
  sub: string; // Google's stable user id
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

function getGoogleClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");
  return clientId;
}

function getGoogleClientSecret() {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return secret;
}

// Builds the URL we send the browser to. `state` is a random value the
// caller generates and stores in a short-lived cookie, then checks against
// the value Google echoes back on the callback — this is what stops a
// forged callback request (CSRF) from logging someone into an attacker's
// chosen account.
export function buildGoogleAuthUrl(redirectUri: string, state: string) {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", getGoogleClientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // Only ask for an account picker — skip the "choose account" step if the
  // browser only has one Google session, but still let people switch.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

// Exchanges the one-time `code` Google sent back for tokens, then verifies
// the id_token's signature against Google's public keys (so we know it was
// genuinely issued by Google, for this exact client, and hasn't expired).
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }

  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new Error("Google token response did not include an id_token");
  }

  const { payload } = await jwtVerify(tokens.id_token, googleJwks, {
    audience: getGoogleClientId(),
    issuer: GOOGLE_ISSUERS,
  });

  if (!payload.sub) {
    throw new Error("Google id_token missing sub claim");
  }

  return {
    sub: payload.sub as string,
    email: (payload.email as string) ?? null,
    emailVerified: Boolean(payload.email_verified),
    name: (payload.name as string) ?? null,
    picture: (payload.picture as string) ?? null,
  };
}
