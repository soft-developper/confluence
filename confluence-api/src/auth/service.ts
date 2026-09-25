import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createPublicClient, defineChain, fallback, getAddress, http } from "viem";
import { generateSiweNonce, parseSiweMessage, verifySiweMessage } from "viem/siwe";
import type { ChainRegistry } from "../chains/registry.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { accounts, authNonces, sessions } from "../db/schema.js";

/**
 * Sign-In with Ethereum (EIP-4361, https://eips.ethereum.org/EIPS/eip-4361) with viem's
 * official helpers (https://viem.sh/docs/siwe/actions/verifySiweMessage). viem checks the
 * message fields and the signature, including smart-contract wallets (ERC-1271 / ERC-6492)
 * through the chain's RPC, and falls back to plain ECDSA recovery.
 */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const NONCE_TTL_MS = 10 * 60_000;
/** A signed message must be fresh: issued within this window. */
export const MAX_MESSAGE_AGE_MS = 10 * 60_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function issueNonce(db: Db) {
  const nonce = generateSiweNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await db.insert(authNonces).values({ nonce, expiresAt });
  return { nonce, expiresAt: expiresAt.toISOString() };
}

export async function verifySignIn(
  db: Db,
  config: Config,
  registry: ChainRegistry,
  input: { message: string; signature: `0x${string}` },
  now = new Date(),
) {
  let msg;
  try {
    msg = parseSiweMessage(input.message);
  } catch {
    throw new AuthError(400, "invalid_message", "not a Sign-In with Ethereum message");
  }
  if (!msg.address || !msg.domain || !msg.nonce || !msg.uri || !msg.chainId || !msg.issuedAt) {
    throw new AuthError(400, "invalid_message", "the message is missing required fields");
  }
  // The message must be for one of OUR web origins (anti-phishing: EIP-4361 domain binding).
  const allowed = config.CORS_ORIGINS.map((o) => new URL(o));
  if (!allowed.some((u) => u.host === msg.domain)) throw new AuthError(401, "wrong_domain", "the message was not created for this site");
  if (!allowed.some((u) => msg.uri!.startsWith(u.origin))) throw new AuthError(401, "wrong_uri", "the message URI is not this site");
  if (now.getTime() - msg.issuedAt.getTime() > MAX_MESSAGE_AGE_MS) throw new AuthError(401, "message_expired", "the message is too old; sign in again");
  const chain = registry.chains.find((c) => c.evmChainId === msg.chainId);
  if (!chain) throw new AuthError(400, "unsupported_chain", "sign in from a supported network");

  const n = await db.query.authNonces.findFirst({ where: eq(authNonces.nonce, msg.nonce) });
  if (!n || n.usedAt || n.expiresAt.getTime() <= now.getTime()) throw new AuthError(401, "invalid_nonce", "the sign-in request expired; try again");

  const client = createPublicClient({
    chain: defineChain({
      id: chain.evmChainId,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: { default: { http: chain.rpcUrls } },
    }),
    transport: fallback(chain.rpcUrls.map((u) => http(u, { timeout: 8_000 }))),
  });
  let ok = false;
  try {
    ok = await verifySiweMessage(client, {
      message: input.message,
      signature: input.signature,
      nonce: msg.nonce,
      domain: msg.domain,
      time: now,
    });
  } catch {
    ok = false;
  }
  if (!ok) throw new AuthError(401, "invalid_signature", "the signature does not match the message");

  // Single use: only the first request that marks the nonce gets a session.
  const used = await db
    .update(authNonces)
    .set({ usedAt: now })
    .where(and(eq(authNonces.nonce, msg.nonce), isNull(authNonces.usedAt)))
    .returning({ nonce: authNonces.nonce });
  if (used.length === 0) throw new AuthError(401, "invalid_nonce", "the sign-in request was already used");

  const address = getAddress(msg.address).toLowerCase();
  await db.insert(accounts).values({ address }).onConflictDoNothing();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: randomUUID(), tokenHash: sha256(token), address, expiresAt });
  return { token, address, expiresAt: expiresAt.toISOString() };
}

export interface SessionInfo {
  sessionId: string;
  address: string;
}

export async function sessionFromToken(db: Db, token: string | undefined, now = new Date()): Promise<SessionInfo | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const s = await db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
  });
  if (!s) return null;
  // Cheap activity marker, at most once a minute per session.
  if (!s.lastUsedAt || now.getTime() - s.lastUsedAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, s.id));
  }
  return { sessionId: s.id, address: s.address };
}

export async function revokeSession(db: Db, sessionId: string, now = new Date()) {
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(db: Db, address: string, now = new Date()) {
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.address, address), isNull(sessions.revokedAt)));
}
