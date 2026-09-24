import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { idempotencyKeys } from "../db/schema.js";

const KEY_FORMAT = /^[A-Za-z0-9_\-:.]{8,128}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

/** JSON with sorted object keys, so {a,b} and {b,a} hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Idempotency for create endpoints. Clients send `Idempotency-Key` (8-128 chars of
 * A-Z a-z 0-9 _ - : .). Outcomes:
 *  - first request: runs, and its final response is stored for 24h
 *  - same key + same body: stored response replayed (header Idempotent-Replayed: true)
 *  - same key + different body: 422 idempotency_key_reused
 *  - same key while the first is still running: 409 idempotency_in_progress
 *  - a 5xx result is NOT stored, so the client can safely retry with the same key
 */
export function idempotency(db: Db, scope: string): RequestHandler {
  return async (req, res, next) => {
    const key = req.get("Idempotency-Key");
    if (!key) {
      res.status(400).json({ error: "idempotency_key_required" });
      return;
    }
    if (!KEY_FORMAT.test(key)) {
      res.status(400).json({ error: "idempotency_key_invalid" });
      return;
    }
    const requestHash = createHash("sha256").update(`${req.method} ${req.path}\n${canonical(req.body)}`).digest("hex");
    const now = Date.now();

    try {
      const inserted = await db
        .insert(idempotencyKeys)
        .values({ scope, key, requestHash, expiresAt: new Date(now + TTL_MS) })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });

      if (inserted.length === 0) {
        const existing = await db.query.idempotencyKeys.findFirst({
          where: and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)),
        });
        if (existing && existing.expiresAt.getTime() <= now) {
          await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
          return idempotency(db, scope)(req, res, next); // expired: start over once
        }
        if (!existing) {
          res.status(409).json({ error: "idempotency_in_progress" });
          return;
        }
        if (existing.requestHash !== requestHash) {
          res.status(422).json({ error: "idempotency_key_reused" });
          return;
        }
        if (existing.responseStatus == null) {
          res.status(409).json({ error: "idempotency_in_progress" });
          return;
        }
        res.set("Idempotent-Replayed", "true");
        res.status(existing.responseStatus).type("application/json").send(existing.responseBody ?? "null");
        return;
      }
    } catch (err) {
      next(err);
      return;
    }

    // First request: capture the JSON response body so it can be replayed.
    let body: string | undefined;
    const originalJson = res.json.bind(res);
    res.json = (payload: unknown) => {
      body = JSON.stringify(payload);
      return originalJson(payload);
    };
    res.on("finish", () => {
      const where = and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key));
      const write =
        res.statusCode >= 500
          ? db.delete(idempotencyKeys).where(where)
          : db.update(idempotencyKeys).set({ responseStatus: res.statusCode, responseBody: body ?? "null" }).where(where);
      write.catch((e: unknown) => console.warn(`idempotency: failed to finalize ${scope}/${key}:`, (e as Error).message));
    });
    next();
  };
}

/** Deletes expired idempotency rows every hour. Timer does not keep the process alive. */
export function startIdempotencySweeper(db: Db, everyMs = 60 * 60 * 1000): NodeJS.Timeout {
  const t = setInterval(() => {
    db.delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()))
      .catch((e: unknown) => console.warn("idempotency sweeper failed:", (e as Error).message));
  }, everyMs);
  t.unref();
  return t;
}
