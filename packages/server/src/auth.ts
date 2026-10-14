import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface SessionUser {
  sub: string; // discord user id
  name: string;
  avatar: string | null; // avatar URL
  exp: number; // ms since epoch
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

// Compact signed token: base64url(json).signature. Not encrypted; it only holds the
// user's public Discord id, name and avatar.
export function signToken(secret: string, payload: object): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken<T extends { exp: number }>(secret: string, token: string, now: number): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return typeof payload.exp === "number" && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

export interface OAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const DISCORD = "https://discord.com";
const STATE_TTL_MS = 10 * 60_000;

// The OAuth `state` is a short-lived signed token, so the server keeps no login memory.
export function authorizeUrl(oauth: OAuthSettings, sessionSecret: string, now: number): string {
  const state = signToken(sessionSecret, { nonce: randomBytes(12).toString("base64url"), exp: now + STATE_TTL_MS });
  const q = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "none",
  });
  return `${DISCORD}/oauth2/authorize?${q}`;
}

export function checkState(sessionSecret: string, state: string, now: number): boolean {
  return verifyToken(sessionSecret, state, now) !== null;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

// Swaps the login code for the user's Discord identity.
export async function exchangeCode(oauth: OAuthSettings, code: string, fetchImpl: typeof fetch): Promise<DiscordUser> {
  const tokenRes = await fetchImpl(`${DISCORD}/api/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: oauth.redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`discord token exchange failed: ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const userRes = await fetchImpl(`${DISCORD}/api/users/@me`, { headers: { authorization: `Bearer ${access_token}` } });
  if (!userRes.ok) throw new Error(`discord user lookup failed: ${userRes.status}`);
  return (await userRes.json()) as DiscordUser;
}

export function avatarUrl(user: DiscordUser): string | null {
  return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
}
