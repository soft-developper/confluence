/**
 * Admin account commands, run on YOUR machine (they need this environment's database
 * credentials in .env, which only you have):
 *   npm run admin:create       create the single owner account (asks for email and password)
 *   npm run admin:reset-2fa    lost phone and backup codes: clear the authenticator; you set
 *                              it up again at the next login (all sessions are signed out)
 *   npm run admin:unlock       clear a lockout after too many failed attempts
 */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { eq, isNull } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { adminBackupCodes, adminSessions, adminUsers } from "../db/schema.js";
import { hashPassword, passwordProblem } from "../admin/crypto.js";

// One readline for the whole command, with a queue, so answers typed ahead (or piped in)
// are never lost between prompts.
let rl: ReturnType<typeof createInterface> | undefined;
let muted = false;
const lines: string[] = [];
const waiting: ((s: string) => void)[] = [];
function ask(question: string, hidden = false): Promise<string> {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    // While a password is typed, echo nothing (the prompt itself is written before muting).
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    out._writeToOutput = (str: string) => {
      if (!muted) out.output.write(str);
    };
    rl.on("line", (l) => {
      const w = waiting.shift();
      if (w) w(l);
      else lines.push(l);
    });
  }
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (a: string) => {
      if (hidden) process.stdout.write("\n");
      muted = false;
      resolve(a.trim());
    };
    const queued = lines.shift();
    if (queued !== undefined) done(queued);
    else waiting.push(done);
  });
}

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // env from the shell
  }
  const cmd = process.argv[2];
  const config = loadConfig();
  const db = createDb(config);
  try {
    if (cmd === "create") {
      const existing = await db.select({ id: adminUsers.id }).from(adminUsers);
      if (existing.length > 0) throw new Error("an admin account already exists (single owner); use admin:reset-2fa or the password reset instead");
      if (!config.ADMIN_SECRET_KEY) console.warn("warning: ADMIN_SECRET_KEY is not set here; login will stay disabled until it is.");
      const email = (await ask("Admin email: ")).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("that does not look like an email address");
      const pw = await ask("Password (12+ characters, hidden): ", true);
      const problem = passwordProblem(pw);
      if (problem) throw new Error(`password: ${problem}`);
      if ((await ask("Repeat password: ", true)) !== pw) throw new Error("passwords do not match");
      await db.insert(adminUsers).values({ id: randomUUID(), email, passwordHash: await hashPassword(pw), passwordChangedAt: new Date() });
      console.log(`[${config.CONFLUENCE_ENV}] admin created for ${email}. Sign in at /admin; you will set up Google Authenticator on first login.`);
    } else if (cmd === "reset-2fa") {
      const email = (await ask("Admin email: ")).toLowerCase();
      const a = await db.query.adminUsers.findFirst({ where: eq(adminUsers.email, email) });
      if (!a) throw new Error("no admin with that email");
      await db.update(adminUsers).set({ totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, totpLastStep: null }).where(eq(adminUsers.id, a.id));
      await db.delete(adminBackupCodes).where(eq(adminBackupCodes.adminId, a.id));
      await db.update(adminSessions).set({ revokedAt: new Date() }).where(isNull(adminSessions.revokedAt));
      console.log(`[${config.CONFLUENCE_ENV}] authenticator cleared for ${email}; all sessions signed out. Set it up again at the next login.`);
    } else if (cmd === "unlock") {
      const email = (await ask("Admin email: ")).toLowerCase();
      const r = await db.update(adminUsers).set({ failedAttempts: 0, lockedUntil: null }).where(eq(adminUsers.email, email)).returning({ id: adminUsers.id });
      console.log(r.length ? `[${config.CONFLUENCE_ENV}] ${email} unlocked.` : "no admin with that email");
    } else {
      throw new Error("usage: tsx src/scripts/adminCli.ts create | reset-2fa | unlock");
    }
  } finally {
    rl?.close();
    db.$client.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
