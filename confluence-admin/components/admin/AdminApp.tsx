"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ADMIN_SIGNED_OUT, adminFetch, clearAdminToken, getAdminToken } from "@/lib/adminApi";
import { CodeForm, LoginForm, SetupForm } from "./AdminAuth";
import { Dashboard } from "./Dashboard";

/**
 * Admin dashboard shell (A3). Stages: login -> authenticator code (or first-time setup)
 * -> dashboard. Signed out after 1 hour without activity: the API enforces it, and this
 * shell tracks activity, keeps the API session alive while you work, warns 2 minutes
 * before, and signs out at 60 minutes.
 */
export const IDLE_MS = 60 * 60_000;
const WARN_MS = 2 * 60_000;
const KEEPALIVE_MS = 5 * 60_000;

type Stage = { kind: "checking" } | { kind: "login"; notice?: string | null } | { kind: "totp" } | { kind: "setup" } | { kind: "dashboard"; email: string; notice?: string | null };

export function AdminApp() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={client}>
      <AdminInner onReset={() => client.clear()} />
    </QueryClientProvider>
  );
}

function AdminInner({ onReset }: { onReset: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const [remaining, setRemaining] = useState<number | null>(null);

  const signOut = useCallback(
    async (notice?: string) => {
      const token = getAdminToken();
      if (token) await adminFetch("/admin/auth/logout", { method: "POST", body: {} }).catch(() => {});
      clearAdminToken();
      onReset();
      setRemaining(null);
      setStage({ kind: "login", notice: notice ?? null });
    },
    [onReset],
  );

  const enterDashboard = useCallback(async () => {
    try {
      const me = await adminFetch<{ email: string }>("/admin/me");
      lastActivity.current = Date.now();
      lastPing.current = Date.now();
      setStage({ kind: "dashboard", email: me.email });
    } catch {
      clearAdminToken();
      setStage({ kind: "login" });
    }
  }, []);

  // Resume an existing session in this tab.
  useEffect(() => {
    if (getAdminToken()) void enterDashboard();
    else setStage({ kind: "login" });
  }, [enterDashboard]);

  // The API ended the session (idle, signed out elsewhere, password changed).
  useEffect(() => {
    const on = (e: Event) => {
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
      onReset();
      setRemaining(null);
      setStage({ kind: "login", notice: reason === "session_expired" ? "You were signed out after 1 hour of inactivity." : "Your session ended. Sign in again." });
    };
    window.addEventListener(ADMIN_SIGNED_OUT, on);
    return () => window.removeEventListener(ADMIN_SIGNED_OUT, on);
  }, [onReset]);

  // Activity tracking, keepalive and the idle timer (dashboard only).
  const inDashboard = stage.kind === "dashboard";
  useEffect(() => {
    if (!inDashboard) return;
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    const timer = setInterval(() => {
      const now = Date.now();
      const idle = now - lastActivity.current;
      if (idle >= IDLE_MS) {
        void signOut("You were signed out after 1 hour of inactivity.");
        return;
      }
      setRemaining(idle >= IDLE_MS - WARN_MS ? IDLE_MS - idle : null);
      // While you are active, keep the API session alive (it only sees API requests).
      if (idle < KEEPALIVE_MS && now - lastPing.current >= KEEPALIVE_MS) {
        lastPing.current = now;
        void adminFetch("/admin/me").catch(() => {});
      }
    }, 1_000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, mark));
      clearInterval(timer);
    };
  }, [inDashboard, signOut]);

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {remaining !== null && (
        <div role="alert" className="flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-3 rounded-md border border-warning bg-bg px-4 py-2 text-[13px]">
          <span>
            You will be signed out in {Math.floor(remaining / 60_000)}:{String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")} for inactivity.
          </span>
          <button
            type="button"
            className="font-medium text-action-text hover:underline"
            onClick={() => {
              lastActivity.current = Date.now();
              lastPing.current = Date.now();
              setRemaining(null);
              void adminFetch("/admin/me").catch(() => {});
            }}
          >
            Stay signed in
          </button>
        </div>
      )}
      {stage.kind === "checking" && <p className="text-sm text-ink-muted">Loading...</p>}
      {stage.kind === "login" && (
        <div className="w-full max-w-[400px]">
          <LoginForm notice={stage.notice} onDone={(r) => setStage({ kind: r.stage })} />
        </div>
      )}
      {stage.kind === "totp" && (
        <div className="w-full max-w-[400px]">
          <CodeForm
            onDone={() => void enterDashboard()}
            onCancel={() => {
              clearAdminToken();
              setStage({ kind: "login" });
            }}
          />
        </div>
      )}
      {stage.kind === "setup" && (
        <div className="w-full max-w-[440px]">
          <SetupForm onDone={() => void enterDashboard()} />
        </div>
      )}
      {stage.kind === "dashboard" && <Dashboard email={stage.email} onSignOut={() => void signOut()} />}
    </div>
  );
}
