import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Admin credential helpers, all on Node's built-in crypto.
 *
 * Passwords: scrypt with OWASP's recommended minimum parameters
 * (N=2^17, r=8, p=1; OWASP Password Storage Cheat Sheet), 16-byte random salt, 64-byte key.
 * Stored as "scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>" so parameters can change later.
 */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;
// scrypt needs about 128 * N * r bytes; Node's default maxmem (32 MiB) is too small.
const MAXMEM = 256 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** OWASP ASVS-style minimums for a single high-value admin account. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return "use at least 12 characters";
  if (pw.length > 128) return "use at most 128 characters";
  if (/^(.)\1+$/.test(pw)) return "do not repeat one character";
  return null;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * TOTP secrets at rest: AES-256-GCM with ADMIN_SECRET_KEY (32 bytes, base64).
 * Format: "v1.<iv b64>.<tag b64>.<ciphertext b64>".
 */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("ADMIN_SECRET_KEY must be 32 bytes (base64)");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(blob: string, keyB64: string): string {
  const [v, ivB64, tagB64, encB64] = blob.split(".");
  if (v !== "v1" || !ivB64 || !tagB64 || !encB64) throw new Error("bad secret format");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(encB64, "base64")), d.final()]).toString("utf8");
}

/** Backup codes: 10 codes like "7KQ2-M9XD" (no 0/O/1/I), shown once, stored as sha256. */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function newBackupCode(): string {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i]! % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export const normalizeBackupCode = (c: string) => c.toUpperCase().replace(/[^0-9A-Z]/g, "");
