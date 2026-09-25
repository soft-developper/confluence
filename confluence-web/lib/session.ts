"use client";

import { useSyncExternalStore } from "react";

/**
 * Sign-in session (Stage 7): the API's session token, kept in this browser and sent as
 * `Authorization: Bearer ...`. One wallet is one account, so a session only counts for
 * the address it was issued to; switching wallets means signing in again.
 */
export interface StoredSession {
  address: string; // lowercase
  token: string;
  expiresAt: string;
}

const KEY = "confluence:session:v1";
const EVENT = "confluence:session-change";

function read(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (!s.token || !s.address || !s.expiresAt || new Date(s.expiresAt).getTime() <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, address: s.address.toLowerCase() }));
  } catch {
    // storage blocked: the session lasts only for this page
  }
  window.dispatchEvent(new Event(EVENT));
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

/** The session token for this wallet, or null (other wallet, expired, or none). */
export function useSession(address: string | undefined): StoredSession | null {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  if (!raw || !address) return null;
  const s = read();
  return s && s.address === address.toLowerCase() ? s : null;
}
