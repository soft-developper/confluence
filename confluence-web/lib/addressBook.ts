"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getAddress, isAddress } from "viem";

/**
 * Address book and recent recipients, stored in this browser (localStorage), one list
 * per connected wallet. The shape is ready for a later server sync (Stage 7): stable
 * ids, updatedAt on every change, and tombstones (deletedAt) instead of hard deletes.
 */
export interface SavedAddress {
  id: string;
  /** EIP-55 checksummed. EVM addresses are the same on every chain. */
  address: `0x${string}`;
  label: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface RecentRecipient {
  address: `0x${string}`;
  lastUsedAt: string;
  count: number;
  /** App Kit chain id of the last destination it was used on. */
  lastChain?: string;
}

interface BookFile {
  version: 1;
  owner: `0x${string}`;
  entries: SavedAddress[];
  recents: RecentRecipient[];
}

export const LABEL_MAX = 40;
const RECENTS_MAX = 10;
const CHANGE_EVENT = "confluence:address-book-change";

const key = (owner: string) => `confluence:address-book:v1:${owner.toLowerCase()}`;

function empty(owner: `0x${string}`): BookFile {
  return { version: 1, owner, entries: [], recents: [] };
}

function read(owner: `0x${string}`): BookFile {
  try {
    const raw = localStorage.getItem(key(owner));
    if (!raw) return empty(owner);
    const f = JSON.parse(raw) as Partial<BookFile>;
    if (f.version !== 1 || !Array.isArray(f.entries) || !Array.isArray(f.recents)) return empty(owner);
    // Drop anything malformed rather than failing the whole list.
    const entries = f.entries.filter(
      (e): e is SavedAddress => !!e && typeof e.id === "string" && typeof e.label === "string" && isAddress(String(e.address), { strict: false }),
    );
    const recents = f.recents.filter(
      (r): r is RecentRecipient => !!r && isAddress(String(r.address), { strict: false }) && typeof r.lastUsedAt === "string",
    );
    return { version: 1, owner, entries, recents };
  } catch {
    return empty(owner);
  }
}

function write(f: BookFile): boolean {
  try {
    localStorage.setItem(key(f.owner), JSON.stringify(f));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false; // storage blocked or full
  }
}

export function cleanLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

/** Adds or renames. Saving an address that is already saved updates its label. */
export function saveAddress(owner: `0x${string}`, address: string, label: string): boolean {
  if (!isAddress(address)) return false;
  const name = cleanLabel(label);
  if (!name) return false;
  const f = read(owner);
  const addr = getAddress(address);
  const now = new Date().toISOString();
  const existing = f.entries.find((e) => e.address.toLowerCase() === addr.toLowerCase());
  if (existing) {
    existing.label = name;
    existing.updatedAt = now;
    delete existing.deletedAt;
  } else {
    f.entries.push({ id: crypto.randomUUID(), address: addr, label: name, createdAt: now, updatedAt: now });
  }
  return write(f);
}

export function deleteAddress(owner: `0x${string}`, id: string): boolean {
  const f = read(owner);
  const e = f.entries.find((x) => x.id === id);
  if (!e) return false;
  const now = new Date().toISOString();
  e.deletedAt = now;
  e.updatedAt = now;
  return write(f);
}

/** Records a recipient the wallet actually sent to (called when a transfer is created). */
export function recordRecipient(owner: `0x${string}`, address: string, chainId?: string): void {
  if (!isAddress(address) || address.toLowerCase() === owner.toLowerCase()) return;
  const f = read(owner);
  const addr = getAddress(address);
  const now = new Date().toISOString();
  const hit = f.recents.find((r) => r.address.toLowerCase() === addr.toLowerCase());
  if (hit) {
    hit.lastUsedAt = now;
    hit.count += 1;
    if (chainId) hit.lastChain = chainId;
  } else {
    f.recents.push({ address: addr, lastUsedAt: now, count: 1, ...(chainId ? { lastChain: chainId } : {}) });
  }
  f.recents.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  f.recents = f.recents.slice(0, RECENTS_MAX);
  write(f);
}

export function removeRecent(owner: `0x${string}`, address: string): void {
  const f = read(owner);
  f.recents = f.recents.filter((r) => r.address.toLowerCase() !== address.toLowerCase());
  write(f);
}

// ---------- server sync (Stage 7b) ----------

/** Every entry including deletion markers, for upload to PUT /me/address-book. */
export function exportEntries(owner: `0x${string}`): SavedAddress[] {
  return read(owner).entries;
}

/**
 * Adopts the server's merged list (newest updatedAt already won per address on the
 * server). Recents stay local. Returns false when storage is blocked.
 */
export function importEntries(owner: `0x${string}`, server: SavedAddress[]): boolean {
  const f = read(owner);
  const cur = JSON.stringify(f.entries);
  const next = server.filter((e) => isAddress(e.address, { strict: false }));
  if (JSON.stringify(next) === cur) return true; // nothing changed: no event, no re-render loop
  f.entries = next.map((e) => ({ ...e, address: getAddress(e.address) }));
  return write(f);
}

/** Subscribe to local address book changes (for debounced uploads). */
export function onAddressBookChange(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

// ---------- React binding ----------

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("confluence:address-book:")) cb();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage); // other tabs
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY_SNAPSHOT = "";

export interface AddressBookView {
  saved: SavedAddress[];
  recents: RecentRecipient[];
  /** Label of a saved address, if any. */
  labelOf: (address: string) => string | undefined;
}

export function useAddressBook(owner: `0x${string}` | undefined): AddressBookView {
  // Subscribe to the raw string so React re-renders only on real changes.
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      if (!owner) return EMPTY_SNAPSHOT;
      try {
        return localStorage.getItem(key(owner)) ?? EMPTY_SNAPSHOT;
      } catch {
        return EMPTY_SNAPSHOT;
      }
    },
    () => EMPTY_SNAPSHOT,
  );
  const f = owner && raw ? read(owner) : undefined;
  const saved = (f?.entries ?? []).filter((e) => !e.deletedAt).sort((a, b) => a.label.localeCompare(b.label));
  const recents = f?.recents ?? [];
  const labelOf = useCallback(
    (address: string) => saved.find((e) => e.address.toLowerCase() === address.toLowerCase())?.label,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw],
  );
  return { saved, recents, labelOf };
}
