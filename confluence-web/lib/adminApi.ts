"use client";

import { publicEnv } from "./env";

/**
 * Admin dashboard client (A3). The session token lives in sessionStorage, so it is gone
 * when the tab closes; the API also ends sessions after 1 hour without activity.
 */
const KEY = "confluence:admin:v1";

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setAdminToken(t: string) {
  try {
    sessionStorage.setItem(KEY, t);
  } catch {
    // storage blocked: the session lasts until reload
  }
}
export function clearAdminToken() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the API says the session is gone (expired, signed out elsewhere). */
export const ADMIN_SIGNED_OUT = "confluence:admin-signed-out";

export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const token = init.token === undefined ? getAdminToken() : init.token;
  const res = await fetch(`${publicEnv.apiUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  let j: unknown = null;
  try {
    j = await res.json();
  } catch {
    // empty body
  }
  if (!res.ok) {
    const b = (j ?? {}) as { error?: string; message?: string };
    const err = new AdminApiError(res.status, b.error ?? `http_${res.status}`, b.message ?? `Request failed (${res.status})`);
    if (res.status === 401 && token && (b.error === "session_expired" || b.error === "session_invalid")) {
      clearAdminToken();
      window.dispatchEvent(new CustomEvent(ADMIN_SIGNED_OUT, { detail: { reason: b.error } }));
    }
    throw err;
  }
  return j as T;
}

// ---------- types from the API (A1, A2) ----------

export type LoginResult = { token: string; stage: "totp" | "setup" };
export type Money = { base: string; usdc: string };

export interface Overview {
  range: string;
  bridge: { total: number; completed: number; failed: number; needsRecovery: number; inProgress: number; successRate: number | null; volume: Money; platformFees: Money };
  swap: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    successRate: number | null;
    volumeByToken: { token: string; swaps: number; volume: number }[];
    feesByToken: { token: string; fees: number }[];
  };
}
export interface Series {
  days: { day: string; bridges: number; bridgeVolume: Money; bridgeFees: Money; swaps: number; swapsCompleted: number }[];
}
export interface Routes {
  bridgeRoutes: { source: string; destination: string; count: number; volume: Money }[];
  speed: Record<string, number>;
  forwarding: { on: number; off: number };
  swapPairs: { chain: string; destination: string; tokenIn: string; tokenOut: string; count: number }[];
}
export interface ActivityItem {
  kind: "bridge" | "swap";
  id: string;
  state: string;
  createdAt: string;
  source: string;
  destination: string | null;
  sender: string;
  recipient: string;
  recipientId: string | null;
  amount: string;
  token: string;
  fee: string | null;
  errorCode: string | null;
  txHash: string | null;
}
export interface Problem {
  kind: "bridge" | "swap";
  id: string;
  state: string;
  reason: string;
  createdAt: string;
  route: string;
  sender: string;
  amount: string;
}
export interface Treasury {
  chains: { chain: string; name: string; recipient: string | null; balance: Money | null; isContract: boolean | null; earned: Money; error: string | null }[];
  total: Money;
  multisigWarning: boolean;
  multisigWarningThreshold: Money;
}
export type SwitchState = { offline: boolean; message: string | null; expectedBack: string | null };
export interface Maintenance {
  state: { bridge: SwitchState; swap: SwitchState; all: SwitchState };
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface FooterSettings {
  builtBy: { name: string; url?: string } | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  copyright: string | null;
  socials: { label: string; url: string }[];
  network: { label: string; url?: string } | null;
}
