import { createHmac, randomBytes } from "node:crypto";

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226): HMAC-SHA1, 6 digits, 30-second steps. These are
 * the parameters Google Authenticator uses, per its key URI format
 * (https://github.com/google/google-authenticator/wiki/Key-Uri-Format).
 */
export const STEP_SECONDS = 30;
export const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (RFC 4226 recommends at least 128 bits; 160 matches SHA-1). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = DIGITS, algorithm: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algorithm, secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

export const stepAt = (unixSeconds: number) => Math.floor(unixSeconds / STEP_SECONDS);

/**
 * Checks a code against the current step and one step either side (clock drift). Returns
 * the matching step, which the caller stores so the same code cannot be used twice.
 */
export function verifyTotp(secretB32: string, code: string, nowSeconds: number, lastUsedStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = stepAt(nowSeconds);
  for (const s of [now, now - 1, now + 1]) {
    if (lastUsedStep !== null && s <= lastUsedStep) continue;
    if (hotp(secret, s) === code) return s;
  }
  return null;
}

/** otpauth:// URI for the QR code (Google Authenticator key URI format). */
export function otpauthUri(secretB32: string, account: string, issuer = "Confluence Admin"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
}
