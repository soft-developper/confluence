/**
 * Pay by Confluence ID (confluence:arc-pay): small browser-side helpers. Every money value
 * that is signed comes from the API; the fee here is only a preview before review.
 */

/** Preview of the platform fee (the API's rule): 0.30 up to 1,000, then 0.30 plus 0.01% of the part above. */
export function previewFeeBase(amountBase: bigint): bigint {
  const flat = 300_000n;
  const threshold = 1_000_000_000n;
  if (amountBase <= 0n) return 0n;
  if (amountBase <= threshold) return flat;
  return flat + ((amountBase - threshold) * 1n + 9_999n) / 10_000n;
}

// ---------- look-alike Confluence IDs ----------

/** Characters people (and scammers) swap for each other. */
const CONFUSABLE: Record<string, string> = { "0": "o", "1": "l", i: "l", "5": "s", "3": "e", "8": "b", "4": "a", "7": "t", rn: "m", vv: "w" };

function skeleton(handle: string): string {
  let s = handle.toLowerCase().replace(/_/g, "");
  s = s.replace(/rn/g, "m").replace(/vv/g, "w");
  return [...s].map((c) => CONFUSABLE[c] ?? c).join("");
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * A known ID that `handle` could be mistaken for (one character away, or the same once
 * look-alike characters are folded: 0/o, 1/l/i, rn/m, underscores). undefined = none.
 */
export function lookalikeId(handle: string, known: readonly string[]): string | undefined {
  const h = handle.toLowerCase();
  const sk = skeleton(h);
  return known.find((k) => {
    const kk = k.toLowerCase();
    if (kk === h) return false;
    return skeleton(kk) === sk || editDistanceAtMostOne(kk, h);
  });
}

// ---------- IDs this wallet has paid before (this browser) ----------

const paidKey = (owner: string) => `confluence:paid-ids:v1:${owner.toLowerCase()}`;
const PAID_MAX = 200;

export function loadPaidIds(owner: string | undefined): string[] {
  if (!owner) return [];
  try {
    const raw = localStorage.getItem(paidKey(owner));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function recordPaidId(owner: string, handle: string): void {
  try {
    const list = loadPaidIds(owner).filter((h) => h !== handle);
    localStorage.setItem(paidKey(owner), JSON.stringify([handle, ...list].slice(0, PAID_MAX)));
  } catch {
    // storage blocked: the first-time warning simply shows again next time
  }
}

// ---------- ID avatar ----------

const PALETTE = ["#2F80EC", "#18B6A7", "#5D5AEF"] as const;

/** Two brand colors and an angle, stable for each ID, so the same person always looks the same. */
export function avatarFor(handle: string): { from: string; to: string; angle: number; letter: string } {
  let h = 2166136261;
  for (const c of handle.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const i = h % 3;
  const a = PALETTE[i]!;
  const b = PALETTE[(i + 1 + ((h >>> 3) % 2)) % 3]!; // always a different color from a
  return { from: a, to: b, angle: (h >>> 8) % 360, letter: (handle[0] ?? "?").toUpperCase() };
}
