import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import express from "express";
import type { AddressInfo } from "node:net";
import { hasBrotliEncoding, rejectBrotliBodies } from "./encoding.js";

test("hasBrotliEncoding spots br in any position and case", () => {
  assert.equal(hasBrotliEncoding(undefined), false);
  assert.equal(hasBrotliEncoding("gzip"), false);
  assert.equal(hasBrotliEncoding("br"), true);
  assert.equal(hasBrotliEncoding(" BR "), true);
  assert.equal(hasBrotliEncoding("gzip, br"), true);
  assert.equal(hasBrotliEncoding(["identity", "br"]), true);
  assert.equal(hasBrotliEncoding("brotli"), false);
});

test("Brotli bodies are refused before the JSON parser; plain and gzip bodies still parse", async () => {
  const app = express();
  app.use(rejectBrotliBodies);
  app.use(express.json());
  app.post("/echo", (req, res) => res.json({ got: req.body }));
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/echo`;
    const body = JSON.stringify({ a: 1 });

    const br = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "content-encoding": "br" }, body: Buffer.from([0x0b, 0x02, 0x80]) });
    assert.equal(br.status, 415);
    assert.deepEqual(await br.json(), { error: "unsupported_encoding" });

    const plain = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.deepEqual(await plain.json(), { got: { a: 1 } });

    const gz = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip" }, body: gzipSync(body) });
    assert.deepEqual(await gz.json(), { got: { a: 1 } });
  } finally {
    server.close();
  }
});
