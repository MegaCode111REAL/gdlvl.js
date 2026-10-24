import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync, deflateRawSync, constants } from "node:zlib";
import { readFileSync } from "node:fs";
import { gzip, gunzip } from "../src/codec.browser.js";

const eq = (a, b, msg) => assert.ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, msg);

// deterministic pseudo-random bytes
const noise = (n, seed = 1) => {
  const u = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; u[i] = s >>> 24; }
  return u;
};
const text = (n) => new TextEncoder().encode("1,8,2,765,3,15,155,1;".repeat(Math.ceil(n / 21)).slice(0, n));

test("gunzip reads what node's zlib writes (all levels, many sizes)", () => {
  for (const level of [0, 1, 6, 9]) {
    for (const n of [0, 1, 2, 100, 5000, 70000, 300000]) {
      for (const data of [text(n), noise(n, n + 7)]) {
        const z = gzipSync(data, { level });
        eq(gunzip(new Uint8Array(z)), data, `level ${level}, size ${n}`);
      }
    }
  }
});

test("gunzip handles fixed-Huffman blocks and the real sample file", () => {
  const fixed = gzipSync(text(500), { strategy: constants.Z_FIXED });
  eq(gunzip(new Uint8Array(fixed)), text(500));
  const b64 = readFileSync(new URL("./fixtures/sample.gdlvl", import.meta.url), "utf8").trim();
  const bytes = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  eq(gunzip(new Uint8Array(bytes)), gunzipSync(bytes));
});

test("gzip output is valid gzip with the right checksum", () => {
  for (const n of [0, 1, 1000, 65535, 65536, 200000]) {
    const data = noise(n, 3);
    const z = gzip(data);
    eq(gunzipSync(Buffer.from(z)), data, `size ${n}`); // node verifies CRC and length itself
    eq(gunzip(z), data);
  }
});

test("bad input fails with an error, not garbage", () => {
  assert.throws(() => gunzip(new Uint8Array([1, 2, 3, 4])), /not gzip/);
  const z = new Uint8Array(gzipSync(text(5000)));
  assert.throws(() => gunzip(z.subarray(0, 20)), /gunzip/);
  void deflateRawSync;
});
