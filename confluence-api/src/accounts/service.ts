import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import type { Db } from "../db/client.js";
import { accounts, addressBookEntries, swaps, transfers } from "../db/schema.js";
import { formatUsdc } from "../lib/usdc.js";

export class AccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ---------- Confluence ID (permanent once claimed) ----------

export const ID_PATTERN = /^[a-z0-9_]{3,20}$/;
/** Names that could impersonate the product, staff or common system routes. */
export const RESERVED_IDS: ReadonlySet<string> = new Set([
  "admin", "administrator", "root", "system", "support", "help", "helpdesk", "security", "staff", "team", "official",
  "confluence", "confluenceid", "circle", "usdc", "eurc", "arc", "cctp", "moderator", "mod", "owner", "founder",
  "api", "app", "www", "mail", "billing", "payments", "pay", "wallet", "bridge", "swap", "profile", "settings",
  "docs", "status", "null", "undefined", "me", "you", "everyone", "anonymous",
]);

export function normalizeId(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function idProblem(handle: string): string | null {
  if (!ID_PATTERN.test(handle)) return "use 3 to 20 characters: letters, digits or underscore";
  if (/^_|_$/.test(handle) || handle.includes("__")) return "underscores cannot start or end the ID or repeat";
  if (RESERVED_IDS.has(handle)) return "this ID is reserved";
  return null;
}

export async function getAccount(db: Db, address: string) {
  const a = await db.query.accounts.findFirst({ where: eq(accounts.address, address) });
  if (!a) throw new AccountError(404, "account_not_found", "account not found");
  return {
    address: getAddress(a.address),
    confluenceId: a.confluenceId,
    idClaimedAt: a.idClaimedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function idAvailability(db: Db, raw: string) {
  const handle = normalizeId(raw);
  const problem = idProblem(handle);
  if (problem) return { handle, available: false, reason: problem };
  const taken = await db.query.accounts.findFirst({ where: eq(accounts.confluenceId, handle) });
  return taken ? { handle, available: false, reason: "already taken" } : { handle, available: true, reason: null };
}

export async function claimId(db: Db, address: string, raw: string) {
  const handle = normalizeId(raw);
  const problem = idProblem(handle);
  if (problem) throw new AccountError(400, "invalid_id", problem);
  const me = await db.query.accounts.findFirst({ where: eq(accounts.address, address) });
  if (!me) throw new AccountError(404, "account_not_found", "account not found");
  if (me.confluenceId) throw new AccountError(409, "id_already_set", `this wallet already has @${me.confluenceId}; IDs are permanent`);
  try {
    // Conditional on "no ID yet", so two concurrent claims cannot both win for one wallet.
    const done = await db
      .update(accounts)
      .set({ confluenceId: handle, idClaimedAt: new Date() })
      .where(and(eq(accounts.address, address), sql`${accounts.confluenceId} IS NULL`))
      .returning({ address: accounts.address });
    if (done.length === 0) throw new AccountError(409, "id_already_set", "this wallet already has an ID; IDs are permanent");
  } catch (e) {
    if (e instanceof AccountError) throw e;
    if (String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error).message).includes("confluence_id")) {
      throw new AccountError(409, "id_taken", `@${handle} is already taken`);
    }
    throw e;
  }
  return getAccount(db, address);
}

export async function lookupId(db: Db, raw: string) {
  const handle = normalizeId(raw);
  if (idProblem(handle) && !RESERVED_IDS.has(handle)) throw new AccountError(404, "id_not_found", "no such Confluence ID");
  const a = await db.query.accounts.findFirst({ where: eq(accounts.confluenceId, handle) });
  if (!a) throw new AccountError(404, "id_not_found", "no such Confluence ID");
  return { handle, address: getAddress(a.address) };
}

// ---------- history (own bridges and swaps) ----------

export interface HistoryItem {
  kind: "bridge" | "swap";
  /** Stage 8a: "in" = someone paid this wallet (it is the recipient, not the sender). */
  direction: "out" | "in";
  /** The other side: recipient for outgoing, sender for incoming (null for own-wallet moves). */
  counterparty: string | null;
  counterpartyId: string | null;
  id: string;
  state: string;
  createdAt: string;
  sourceChain: string;
  destinationChain: string | null;
  amountIn: string;
  tokenIn: string;
  tokenOut: string;
  amountOut: string | null;
  recipient: string;
  txHash: string | null;
  errorCode: string | null;
}

/** The signed-in wallet's bridges and swaps, newest first; `before` pages backwards. */
export async function history(db: Db, address: string, opts: { limit: number; before?: Date | undefined }) {
  const lim = Math.min(Math.max(opts.limit, 1), 50);
  // Outgoing (this wallet sent) and incoming (this wallet was paid).
  const owner = or(sql`lower(${transfers.sender}) = ${address}`, sql`lower(${transfers.recipient}) = ${address}`)!;
  const t = await db
    .select()
    .from(transfers)
    .where(opts.before ? and(owner, lt(transfers.createdAt, opts.before)) : owner)
    .orderBy(desc(transfers.createdAt))
    .limit(lim);
  const swapOwner = sql`lower(${swaps.sender}) = ${address}`;
  const s = await db
    .select()
    .from(swaps)
    .where(opts.before ? and(swapOwner, lt(swaps.createdAt, opts.before)) : swapOwner)
    .orderBy(desc(swaps.createdAt))
    .limit(lim);
  // Confluence IDs of people who paid this wallet.
  const payers = [...new Set(t.filter((x) => x.sender.toLowerCase() !== address).map((x) => x.sender.toLowerCase()))];
  const payerIds = new Map(
    payers.length
      ? (await db.select({ a: accounts.address, id: accounts.confluenceId }).from(accounts).where(inArray(accounts.address, payers))).map((r) => [r.a, r.id])
      : [],
  );
  const items: (HistoryItem & { at: number })[] = [
    ...t.map((x) => {
      const incoming = x.sender.toLowerCase() !== address;
      const self = x.recipient.toLowerCase() === x.sender.toLowerCase();
      return {
      kind: "bridge" as const,
      direction: incoming ? ("in" as const) : ("out" as const),
      counterparty: self ? null : incoming ? getAddress(x.sender) : getAddress(x.recipient),
      counterpartyId: self ? null : incoming ? (payerIds.get(x.sender.toLowerCase()) ?? null) : x.recipientId,
      id: x.id,
      state: x.state,
      at: x.createdAt.getTime(),
      createdAt: x.createdAt.toISOString(),
      sourceChain: x.sourceChain,
      destinationChain: x.destinationChain,
      amountIn: formatUsdc(BigInt(x.amountBase)),
      tokenIn: "USDC",
      tokenOut: "USDC",
      amountOut: null,
      recipient: x.recipient,
      txHash: x.burnTxHash,
      errorCode: x.errorCode,
      };
    }),
    ...s.map((x) => ({
      kind: "swap" as const,
      direction: "out" as const,
      counterparty: x.recipient.toLowerCase() === x.sender.toLowerCase() ? null : getAddress(x.recipient),
      counterpartyId: null,
      id: x.id,
      state: x.state,
      at: x.createdAt.getTime(),
      createdAt: x.createdAt.toISOString(),
      sourceChain: x.chain,
      destinationChain: x.destinationChain,
      amountIn: x.amountIn,
      tokenIn: x.tokenIn,
      tokenOut: x.tokenOut,
      amountOut: x.amountOut ?? x.estimatedOut,
      recipient: x.recipient,
      txHash: x.swapTxHash,
      errorCode: x.errorCode,
    })),
  ];
  items.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const page = items.slice(0, lim);
  const more = items.length > lim || t.length === lim || s.length === lim;
  const last = page.at(-1);
  return {
    items: page.map(({ at: _at, ...rest }) => rest),
    nextBefore: more && last ? last.createdAt : null,
  };
}

// ---------- address book sync ----------

export interface BookEntryIn {
  id: string;
  address: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null | undefined;
}

export const BOOK_MAX = 500;

function bookOut(rows: (typeof addressBookEntries.$inferSelect)[]) {
  return rows.map((r) => ({
    id: r.id,
    address: r.displayAddress,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(r.deletedAt ? { deletedAt: r.deletedAt.toISOString() } : {}),
  }));
}

export async function getBook(db: Db, owner: string) {
  const rows = await db.select().from(addressBookEntries).where(eq(addressBookEntries.owner, owner));
  return bookOut(rows);
}

/**
 * Merges the browser's list into the server copy: per address, the entry with the newest
 * updatedAt wins (including deletions). Returns the merged list for the browser to adopt.
 */
export async function mergeBook(db: Db, owner: string, incoming: BookEntryIn[]) {
  if (incoming.length > BOOK_MAX) throw new AccountError(400, "too_many_entries", `at most ${BOOK_MAX} entries`);
  const existing = new Map((await db.select().from(addressBookEntries).where(eq(addressBookEntries.owner, owner))).map((r) => [r.address, r]));
  const now = Date.now();
  const writes = [];
  for (const e of incoming) {
    // Any case is fine: the browser stores EIP-55, but lowercase is the same address.
    if (!isAddress(e.address, { strict: false })) continue;
    const key = e.address.toLowerCase();
    const updated = new Date(e.updatedAt);
    const created = new Date(e.createdAt);
    if (Number.isNaN(updated.getTime()) || Number.isNaN(created.getTime())) continue;
    if (updated.getTime() > now + 5 * 60_000) continue; // reject clocks far in the future
    const cur = existing.get(key);
    if (cur && cur.updatedAt.getTime() >= updated.getTime()) continue;
    const row = {
      owner,
      address: key,
      id: cur?.id ?? e.id,
      displayAddress: getAddress(e.address),
      label: e.label.replace(/\s+/g, " ").trim().slice(0, 40) || (cur?.label ?? "Saved address"),
      createdAt: cur?.createdAt ?? created,
      updatedAt: updated,
      deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
    };
    existing.set(key, row as typeof addressBookEntries.$inferSelect);
    writes.push(
      db
        .insert(addressBookEntries)
        .values(row)
        .onConflictDoUpdate({
          target: [addressBookEntries.owner, addressBookEntries.address],
          set: { label: row.label, displayAddress: row.displayAddress, updatedAt: row.updatedAt, deletedAt: row.deletedAt },
        }),
    );
  }
  if (writes.length > 0) {
    if (existing.size > BOOK_MAX) throw new AccountError(400, "too_many_entries", `at most ${BOOK_MAX} entries`);
    await db.batch(writes as [ (typeof writes)[number], ...(typeof writes)[number][] ]);
  }
  return getBook(db, owner);
}
