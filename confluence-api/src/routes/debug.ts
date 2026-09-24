import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Config } from "../config.js";

/**
 * TEMPORARY (Stage 0f): shows how the API sees the client IP behind Render's proxy,
 * so TRUST_PROXY_HOPS can be verified on the live service. Disabled (404) unless
 * DEBUG_TOKEN is set, and requires header X-Debug-Token. Removed after verification.
 */
export function debugRouter(config: Config) {
  const router = Router();
  router.get("/debug/client-ip", (req, res) => {
    const expected = config.DEBUG_TOKEN;
    const given = req.get("X-Debug-Token") ?? "";
    const ok =
      !!expected &&
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      trustProxyHops: config.TRUST_PROXY_HOPS,
      reqIp: req.ip,
      reqIps: req.ips,
      xForwardedFor: req.get("X-Forwarded-For") ?? null,
      socketRemoteAddress: req.socket.remoteAddress ?? null,
    });
  });
  return router;
}
