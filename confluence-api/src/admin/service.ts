import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { adminBackupCodes, adminResetTokens, adminSessions, adminUsers } from "../db/schema.js";
import { securityEmail, type SendEmail } from "../email/resend.js";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  newBackupCode,
  newToken,
  normalizeBackupCode,
  passwordProblem,
  sha256,
  verifyPassword,
} from "./crypto.js";
import { newTotpSecret, otpauthUri, verifyTotp } from "./totp.js";

/**
 * Single-owner admin authentication (A1): email + password, then a Google Authenticator
 * code (or a one-time backup code). Sessions end after 1 hour without activity and at
 * most 12 hours after login. Failures never say which part was wrong.
 */
export class AdminAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const IDLE_TIMEOUT_MS = 60 * 60_000; // 1 hour of inactivity
export const MAX_SESSION_MS = 12 * 60 * 60_000; // hard cap
export const PENDING_STAGE_MS = 10 * 60_000; // time to type the code after the password
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60_000;
export const RESET_TTL_MS = 15 * 60_000;
export const BACKUP_CODE_COUNT = 10;

const INVALID = () => new AdminAuthError(401, "invalid_credentials", "invalid credentials");

export interface AdminDeps {
  db: Db;
  secretKey: string | undefined;
  webOrigin: string;
  sendEmail: SendEmail;
  now?: () => number;
}

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

function requireKey(d: AdminDeps): string {
  if (!d.secretKey) throw new AdminAuthError(503, "admin_not_configured", "admin login is not configured on this server");
  return d.secretKey;
}
const nowOf = (d: AdminDeps) => (d.now ? d.now() : Date.now());
const where = (m: RequestMeta) => `IP ${m.ip ?? "unknown"}, ${m.userAgent?.slice(0, 120) ?? "unknown browser"}`;

async function newSession(d: AdminDeps, adminId: string, stage: "totp" | "setup" | "active", m: RequestMeta) {
  const token = newToken();
  const now = nowOf(d);
  await d.db.insert(adminSessions).values({
    id: randomUUID(),
    adminId,
    tokenHash: sha256(token),
    stage,
    ip: m.ip?.slice(0, 64) ?? null,
    userAgent: m.userAgent?.slice(0, 300) ?? null,
    lastActivityAt: new Date(now),
    expiresAt: new Date(now + (stage === "active" ? MAX_SESSION_MS : PENDING_STAGE_MS)),
  });
  return token;
}

async function recordFailure(d: AdminDeps, admin: typeof adminUsers.$inferSelect, m: RequestMeta) {
  const failed = admin.failedAttempts + 1;
  const lock = failed >= MAX_FAILED;
  await d.db
    .update(adminUsers)
    .set({ failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(nowOf(d) + LOCK_MS) : admin.lockedUntil })
    .where(eq(adminUsers.id, admin.id));
  if (lock) {
    const e = securityEmail("Confluence admin locked for 15 minutes", [
      `${MAX_FAILED} failed sign-in attempts in a row.`,
      `Last attempt: ${new Date(nowOf(d)).toUTCString()}, ${where(m)}.`,
    ]);
    void d.sendEmail({ to: admin.email, subject: "Confluence admin: account locked", ...e });
  }
}

function assertNotLocked(d: AdminDeps, admin: typeof adminUsers.$inferSelect) {
  if (admin.lockedUntil && admin.lockedUntil.getTime() > nowOf(d)) {
    throw new AdminAuthError(429, "locked", "too many attempts; try again later");
  }
}

// ---------- login ----------

/** Step 1: email + password. Returns a short-lived token for the code step (or setup). */
export async function login(d: AdminDeps, email: string, password: string, m: RequestMeta) {
  requireKey(d);
  const admin = await d.db.query.adminUsers.findFirst({ where: eq(adminUsers.email, email.trim().toLowerCase()) });
  if (!admin) {
    await verifyPassword(password, "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "=="); // equalize timing
    throw INVALID();
  }
  assertNotLocked(d, admin);
  if (!(await verifyPassword(password, admin.passwordHash))) {
    await recordFailure(d, admin, m);
    throw INVALID();
  }
  const stage = admin.totpEnabledAt ? "totp" : "setup";
  return { token: await newSession(d, admin.id, stage, m), stage };
}

async function pendingSession(d: AdminDeps, token: string | undefined, stage: "totp" | "setup") {
  if (!token) throw INVALID();
  const s = await d.db.query.adminSessions.findFirst({
    where: and(eq(adminSessions.tokenHash, sha256(token)), isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, new Date(nowOf(d)))),
  });
  if (!s || s.stage !== stage) throw new AdminAuthError(401, "session_invalid", "sign in again");
  const admin = await d.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, s.adminId) });
  if (!admin) throw new AdminAuthError(401, "session_invalid", "sign in again");
  return { s, admin };
}

async function activate(d: AdminDeps, sessionId: string) {
  const now = nowOf(d);
  await d.db
    .update(adminSessions)
    .set({ stage: "active", lastActivityAt: new Date(now), expiresAt: new Date(now + MAX_SESSION_MS) })
    .where(eq(adminSessions.id, sessionId));
}

/** Step 2: the 6-digit authenticator code, or a backup code. */
export async function verifySecondFactor(d: AdminDeps, token: string | undefined, code: string, m: RequestMeta) {
  const key = requireKey(d);
  const { s, admin } = await pendingSession(d, token, "totp");
  assertNotLocked(d, admin);
  const clean = code.trim();
  let usedBackup = false;
  if (/^\d{6}$/.test(clean)) {
    const secret = decryptSecret(admin.totpSecretEnc!, key);
    const step = verifyTotp(secret, clean, Math.floor(nowOf(d) / 1000), admin.totpLastStep ?? null);
    if (step === null) {
      await recordFailure(d, admin, m);
      throw INVALID();
    }
    await d.db.update(adminUsers).set({ totpLastStep: step, failedAttempts: 0 }).where(eq(adminUsers.id, admin.id));
  } else {
    const hash = sha256(normalizeBackupCode(clean));
    const used = await d.db
      .update(adminBackupCodes)
      .set({ usedAt: new Date(nowOf(d)) })
      .where(and(eq(adminBackupCodes.adminId, admin.id), eq(adminBackupCodes.codeHash, hash), isNull(adminBackupCodes.usedAt)))
      .returning({ id: adminBackupCodes.id });
    if (used.length === 0) {
      await recordFailure(d, admin, m);
      throw INVALID();
    }
    usedBackup = true;
    await d.db.update(adminUsers).set({ failedAttempts: 0 }).where(eq(adminUsers.id, admin.id));
  }
  await activate(d, s.id);
  const left = usedBackup
    ? (await d.db.select().from(adminBackupCodes).where(and(eq(adminBackupCodes.adminId, admin.id), isNull(adminBackupCodes.usedAt)))).length
    : null;
  const e = securityEmail("New sign-in to the Confluence admin dashboard", [
    `Time: ${new Date(nowOf(d)).toUTCString()}.`,
    `From: ${where(m)}.`,
    ...(usedBackup ? [`A backup code was used. ${left} backup codes left.`] : []),
  ]);
  void d.sendEmail({ to: admin.email, subject: "Confluence admin: new sign-in", ...e, idempotencyKey: `admin-login/${s.id}` });
  return { stage: "active" as const, ...(left !== null ? { backupCodesLeft: left } : {}) };
}

// ---------- authenticator setup (first login, or after a CLI reset) ----------

export async function beginTotpSetup(d: AdminDeps, token: string | undefined) {
  const key = requireKey(d);
  const { admin } = await pendingSession(d, token, "setup");
  const secret = newTotpSecret();
  await d.db.update(adminUsers).set({ totpPendingEnc: encryptSecret(secret, key) }).where(eq(adminUsers.id, admin.id));
  return { secret, otpauthUri: otpauthUri(secret, admin.email) };
}

async function issueBackupCodes(d: AdminDeps, adminId: string): Promise<string[]> {
  await d.db.delete(adminBackupCodes).where(eq(adminBackupCodes.adminId, adminId));
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
  await d.db.insert(adminBackupCodes).values(codes.map((c) => ({ id: randomUUID(), adminId, codeHash: sha256(normalizeBackupCode(c)) })));
  return codes;
}

/** Confirms the authenticator with a first code; returns backup codes (shown once). */
export async function confirmTotpSetup(d: AdminDeps, token: string | undefined, code: string, m: RequestMeta) {
  const key = requireKey(d);
  const { s, admin } = await pendingSession(d, token, "setup");
  if (!admin.totpPendingEnc) throw new AdminAuthError(409, "setup_not_started", "start the authenticator setup first");
  const secret = decryptSecret(admin.totpPendingEnc, key);
  const step = verifyTotp(secret, code.trim(), Math.floor(nowOf(d) / 1000), null);
  if (step === null) throw new AdminAuthError(400, "invalid_code", "that code did not match; check the time on your phone and try again");
  await d.db
    .update(adminUsers)
    .set({ totpSecretEnc: admin.totpPendingEnc, totpPendingEnc: null, totpEnabledAt: new Date(nowOf(d)), totpLastStep: step })
    .where(eq(adminUsers.id, admin.id));
  const codes = await issueBackupCodes(d, admin.id);
  await activate(d, s.id);
  const e = securityEmail("Authenticator enabled for the Confluence admin dashboard", [
    `Time: ${new Date(nowOf(d)).toUTCString()}, ${where(m)}.`,
    `${BACKUP_CODE_COUNT} new backup codes were created; older ones no longer work.`,
  ]);
  void d.sendEmail({ to: admin.email, subject: "Confluence admin: authenticator enabled", ...e });
  return { stage: "active" as const, backupCodes: codes };
}

// ---------- active sessions ----------

export interface ActiveAdmin {
  sessionId: string;
  adminId: string;
  email: string;
}

/** Validates an active session and records activity; ends it after 1 hour idle. */
export async function touchSession(d: AdminDeps, token: string | undefined): Promise<ActiveAdmin> {
  if (!token || token.length < 20 || token.length > 100) throw new AdminAuthError(401, "session_invalid", "sign in again");
  const now = nowOf(d);
  const s = await d.db.query.adminSessions.findFirst({ where: eq(adminSessions.tokenHash, sha256(token)) });
  if (!s || s.revokedAt || s.stage !== "active") throw new AdminAuthError(401, "session_invalid", "sign in again");
  if (s.expiresAt.getTime() <= now || now - s.lastActivityAt.getTime() > IDLE_TIMEOUT_MS) {
    await d.db.update(adminSessions).set({ revokedAt: new Date(now) }).where(eq(adminSessions.id, s.id));
    throw new AdminAuthError(401, "session_expired", "signed out after inactivity; sign in again");
  }
  await d.db.update(adminSessions).set({ lastActivityAt: new Date(now) }).where(eq(adminSessions.id, s.id));
  const admin = await d.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, s.adminId) });
  if (!admin) throw new AdminAuthError(401, "session_invalid", "sign in again");
  return { sessionId: s.id, adminId: admin.id, email: admin.email };
}

export async function logout(d: AdminDeps, sessionId: string) {
  await d.db.update(adminSessions).set({ revokedAt: new Date(nowOf(d)) }).where(eq(adminSessions.id, sessionId));
}

async function revokeAll(d: AdminDeps, adminId: string) {
  await d.db
    .update(adminSessions)
    .set({ revokedAt: new Date(nowOf(d)) })
    .where(and(eq(adminSessions.adminId, adminId), isNull(adminSessions.revokedAt)));
}

/** Change password while signed in (needs the current password and a fresh code). */
export async function changePassword(d: AdminDeps, a: ActiveAdmin, current: string, next: string, code: string, m: RequestMeta) {
  const key = requireKey(d);
  const admin = await d.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, a.adminId) });
  if (!admin) throw INVALID();
  if (!(await verifyPassword(current, admin.passwordHash))) throw INVALID();
  const step = verifyTotp(decryptSecret(admin.totpSecretEnc!, key), code.trim(), Math.floor(nowOf(d) / 1000), admin.totpLastStep ?? null);
  if (step === null) throw INVALID();
  const problem = passwordProblem(next);
  if (problem) throw new AdminAuthError(400, "weak_password", problem);
  await d.db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(nowOf(d)), totpLastStep: step })
    .where(eq(adminUsers.id, admin.id));
  await revokeAll(d, admin.id);
  const e = securityEmail("Confluence admin password changed", [`Time: ${new Date(nowOf(d)).toUTCString()}, ${where(m)}.`, "All sessions were signed out."]);
  void d.sendEmail({ to: admin.email, subject: "Confluence admin: password changed", ...e });
}

/** New backup codes (needs a fresh authenticator code); old ones stop working. */
export async function regenerateBackupCodes(d: AdminDeps, a: ActiveAdmin, code: string) {
  const key = requireKey(d);
  const admin = await d.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, a.adminId) });
  if (!admin) throw INVALID();
  const step = verifyTotp(decryptSecret(admin.totpSecretEnc!, key), code.trim(), Math.floor(nowOf(d) / 1000), admin.totpLastStep ?? null);
  if (step === null) throw INVALID();
  await d.db.update(adminUsers).set({ totpLastStep: step }).where(eq(adminUsers.id, admin.id));
  return issueBackupCodes(d, admin.id);
}

// ---------- password reset by email ----------

/** Always succeeds from the caller's view, so it cannot reveal whether an email exists. */
export async function requestPasswordReset(d: AdminDeps, email: string, m: RequestMeta) {
  requireKey(d);
  const admin = await d.db.query.adminUsers.findFirst({ where: eq(adminUsers.email, email.trim().toLowerCase()) });
  if (!admin) return;
  const token = newToken();
  await d.db.insert(adminResetTokens).values({
    id: randomUUID(),
    adminId: admin.id,
    tokenHash: sha256(token),
    expiresAt: new Date(nowOf(d) + RESET_TTL_MS),
  });
  const url = `${d.webOrigin.replace(/\/$/, "")}/admin/reset?token=${encodeURIComponent(token)}`;
  const e = securityEmail(
    "Reset your Confluence admin password",
    [
      `Someone asked to reset the admin password at ${new Date(nowOf(d)).toUTCString()} (${where(m)}).`,
      "The link works once and expires in 15 minutes. Your authenticator code is still needed after resetting.",
    ],
    { label: "Reset password", url },
  );
  void d.sendEmail({ to: admin.email, subject: "Confluence admin: password reset", ...e });
}

export async function resetPassword(d: AdminDeps, token: string, next: string, m: RequestMeta) {
  requireKey(d);
  const problem = passwordProblem(next);
  if (problem) throw new AdminAuthError(400, "weak_password", problem);
  const now = nowOf(d);
  const used = await d.db
    .update(adminResetTokens)
    .set({ usedAt: new Date(now) })
    .where(and(eq(adminResetTokens.tokenHash, sha256(token)), isNull(adminResetTokens.usedAt), gt(adminResetTokens.expiresAt, new Date(now))))
    .returning({ adminId: adminResetTokens.adminId });
  if (used.length === 0) throw new AdminAuthError(400, "invalid_reset", "this reset link is invalid or has expired");
  const adminId = used[0]!.adminId;
  await d.db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(now), failedAttempts: 0, lockedUntil: null })
    .where(eq(adminUsers.id, adminId));
  await revokeAll(d, adminId);
  const admin = await d.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, adminId) });
  if (admin) {
    const e = securityEmail("Confluence admin password was reset", [`Time: ${new Date(now).toUTCString()}, ${where(m)}.`, "All sessions were signed out."]);
    void d.sendEmail({ to: admin.email, subject: "Confluence admin: password reset completed", ...e });
  }
}

