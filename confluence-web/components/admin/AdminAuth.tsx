"use client";

import QRCode from "qrcode";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminApiError, adminFetch, setAdminToken, type LoginResult } from "@/lib/adminApi";
import { Btn, ErrorText, Field, inputCls, Panel } from "./ui";

const msg = (e: unknown) =>
  e instanceof AdminApiError
    ? e.code === "locked"
      ? "Too many attempts. Try again in 15 minutes."
      : e.code === "invalid_credentials"
        ? "Invalid credentials."
        : e.code === "admin_not_configured"
          ? "Admin login is not configured on the server (ADMIN_SECRET_KEY)."
          : e.code === "rate_limited"
            ? "Too many requests. Wait a minute."
            : e.message
    : "Could not reach the Confluence API.";

export function LoginForm({ onDone, notice }: { onDone: (r: LoginResult) => void; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  if (forgot) return <ForgotForm onBack={() => setForgot(false)} />;
  return (
    <Panel title="Admin sign in">
      {notice && (
        <p role="status" className="rounded-md border border-warning bg-bg p-3 text-[13px]">
          {notice}
        </p>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const r = await adminFetch<LoginResult>("/admin/auth/login", { method: "POST", body: { email, password }, token: null });
            setAdminToken(r.token);
            setPassword("");
            onDone(r);
          } catch (x) {
            setErr(msg(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email">
          <input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText>{err}</ErrorText>
        <Btn type="submit" disabled={busy || !email || !password}>
          {busy ? "Checking..." : "Continue"}
        </Btn>
      </form>
      <button type="button" onClick={() => setForgot(true)} className="self-start text-[13px] text-action-text hover:underline">
        Forgot password?
      </button>
    </Panel>
  );
}

export function CodeForm({ onDone, onCancel }: { onDone: (backupCodesLeft?: number) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Authenticator code">
      <p className="text-sm text-ink-muted">Enter the 6-digit code from Google Authenticator, or one of your backup codes.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const r = await adminFetch<{ backupCodesLeft?: number }>("/admin/auth/totp", { method: "POST", body: { code } });
            onDone(r.backupCodesLeft);
          } catch (x) {
            setErr(x instanceof AdminApiError && x.code === "session_invalid" ? "That took too long. Sign in again." : msg(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          className={`${inputCls} tnum text-center font-mono text-lg tracking-[0.3em]`}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.slice(0, 12))}
          aria-label="Authenticator or backup code"
          autoFocus
        />
        <ErrorText>{err}</ErrorText>
        <Btn type="submit" disabled={busy || code.trim().length < 6}>
          {busy ? "Verifying..." : "Sign in"}
        </Btn>
      </form>
      <button type="button" onClick={onCancel} className="self-start text-[13px] text-ink-muted hover:text-ink">
        Back
      </button>
    </Panel>
  );
}

/** First login (or after a CLI reset): scan the QR code, confirm a code, save backup codes. */
export function SetupForm({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    adminFetch<{ secret: string; otpauthUri: string }>("/admin/auth/totp/setup", { method: "POST", body: {} })
      .then(async (s) => {
        const qr = await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 220 });
        if (live) setSetup({ ...s, qr });
      })
      .catch((e: unknown) => live && setErr(msg(e)));
    return () => {
      live = false;
    };
  }, []);

  if (codes) {
    const text = `Confluence admin backup codes (each works once)\n\n${codes.join("\n")}\n`;
    return (
      <Panel title="Save your backup codes">
        <p className="text-sm text-ink-muted">
          Each code works once instead of an authenticator code. Store them offline. They will not be shown again.
        </p>
        <ol className="grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => (
            <li key={c} className="rounded-md border border-border bg-bg px-3 py-2 text-center">
              {c}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Btn kind="secondary" onClick={() => void navigator.clipboard?.writeText(text)}>
            Copy
          </Btn>
          <a
            className="flex h-10 items-center rounded-md border border-border-control px-4 text-sm font-medium hover:border-action-text"
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
            download="confluence-admin-backup-codes.txt"
          >
            Download .txt
          </a>
        </div>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5" />I saved these codes somewhere safe.
        </label>
        <Btn onClick={onDone} disabled={!saved}>
          Continue to the dashboard
        </Btn>
      </Panel>
    );
  }

  return (
    <Panel title="Set up Google Authenticator">
      <p className="text-sm text-ink-muted">Scan this QR code in Google Authenticator (or any TOTP app), then enter the 6-digit code it shows.</p>
      {setup ? (
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="Authenticator QR code" width={220} height={220} className="rounded-md bg-white p-2" />
          <details className="w-full text-xs text-ink-muted">
            <summary className="cursor-pointer">Can&apos;t scan? Enter this setup key instead</summary>
            <code className="mt-2 block rounded-md border border-border bg-bg p-2 font-mono break-all">{setup.secret}</code>
          </details>
        </div>
      ) : (
        !err && <p className="text-sm text-ink-muted">Preparing...</p>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            const r = await adminFetch<{ backupCodes: string[] }>("/admin/auth/totp/confirm", { method: "POST", body: { code } });
            setCodes(r.backupCodes);
          } catch (x) {
            setErr(x instanceof AdminApiError && x.code === "invalid_code" ? "That code did not match. Check the time on your phone and try again." : msg(x));
          }
        }}
      >
        <input
          className={`${inputCls} tnum text-center font-mono text-lg tracking-[0.3em]`}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          aria-label="6-digit code"
        />
        <ErrorText>{err}</ErrorText>
        <Btn type="submit" disabled={!setup || code.length !== 6}>
          Confirm
        </Btn>
      </form>
    </Panel>
  );
}

function ForgotForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Panel title="Reset password">
      {done ? (
        <p role="status" className="text-sm">
          {done}
        </p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              const r = await adminFetch<{ message: string }>("/admin/auth/forgot", { method: "POST", body: { email }, token: null });
              setDone(r.message);
            } catch (x) {
              setErr(msg(x));
            }
          }}
        >
          <p className="text-sm text-ink-muted">We&apos;ll email a single-use link, valid for 15 minutes. You will still need your authenticator code afterwards.</p>
          <Field label="Email">
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <ErrorText>{err}</ErrorText>
          <Btn type="submit" disabled={!email}>
            Send reset link
          </Btn>
        </form>
      )}
      <button type="button" onClick={onBack} className="self-start text-[13px] text-ink-muted hover:text-ink">
        Back to sign in
      </button>
    </Panel>
  );
}

export function ResetPasswordForm() {
  const [token, setToken] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);
  if (done) {
    return (
      <Panel title="Password changed">
        <p className="text-sm">All sessions were signed out. Sign in with your new password and your authenticator code.</p>
        <Link href="/admin" className="text-sm text-action-text">
          Go to sign in
        </Link>
      </Panel>
    );
  }
  return (
    <Panel title="Choose a new password">
      {!token ? (
        <p className="text-sm text-danger">This link is missing its token. Request a new reset email.</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            if (pw !== pw2) return setErr("The passwords do not match.");
            try {
              await adminFetch("/admin/auth/reset", { method: "POST", body: { token, password: pw }, token: null });
              setDone(true);
            } catch (x) {
              setErr(msg(x));
            }
          }}
        >
          <Field label="New password" hint="At least 12 characters.">
            <input className={inputCls} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          </Field>
          <Field label="Repeat new password">
            <input className={inputCls} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
          </Field>
          <ErrorText>{err}</ErrorText>
          <Btn type="submit" disabled={pw.length < 12 || !pw2}>
            Set new password
          </Btn>
        </form>
      )}
    </Panel>
  );
}
