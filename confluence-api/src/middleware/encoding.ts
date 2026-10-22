import type { NextFunction, Request, Response } from "express";

/**
 * Refuse Brotli-compressed request bodies (confluence:security-oct26).
 *
 * express.json() inflates "br" bodies through Node's Brotli decoder, and the October 2026
 * Node.js security release fixes an out-of-bounds write in that decoder (CVE-2026-111497).
 * No Confluence client sends compressed request bodies (the app, the admin and Relay's
 * webhook all post plain JSON), so refusing "br" costs nothing and keeps the decoder out of
 * reach of anyone on the internet, whatever Node version the host is running.
 * gzip and deflate are left alone.
 */
export function hasBrotliEncoding(header: string | string[] | undefined): boolean {
  if (header === undefined) return false;
  const value = Array.isArray(header) ? header.join(",") : header;
  return value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .includes("br");
}

export function rejectBrotliBodies(req: Request, res: Response, next: NextFunction) {
  if (hasBrotliEncoding(req.headers["content-encoding"])) {
    res.status(415).json({ error: "unsupported_encoding" });
    return;
  }
  next();
}
