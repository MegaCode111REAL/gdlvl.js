// Dependency-free gzip codec for browsers (and anywhere else), so the page needs no build step.
//
//   gunzip: a complete inflate (stored, fixed and dynamic Huffman blocks), so it reads whatever the
//           game wrote.
//   gzip:   writes "stored" (uncompressed) deflate blocks, which every gzip reader accepts. Files
//           come out larger than the game's own, but they are valid and load fine.
//
// Bundlers also pick this file through the "browser" condition in package.json.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function gzip(u8) {
  const blocks = Math.max(1, Math.ceil(u8.length / 65535));
  const out = new Uint8Array(10 + u8.length + blocks * 5 + 8);
  out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255]); // header: deflate, no flags, no mtime, OS unknown
  let p = 10;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535, len = Math.min(65535, u8.length - start);
    out[p++] = i === blocks - 1 ? 1 : 0; // BFINAL, BTYPE=00 (stored)
    out[p++] = len & 255; out[p++] = len >>> 8;
    out[p++] = ~len & 255; out[p++] = (~len >>> 8) & 255;
    out.set(u8.subarray(start, start + len), p);
    p += len;
  }
  const crc = crc32(u8), n = u8.length;
  for (let i = 0; i < 4; i++) out[p++] = (crc >>> (8 * i)) & 255;
  for (let i = 0; i < 4; i++) out[p++] = (n >>> (8 * i)) & 255;
  return out;
}

// ---------------------------------------------------------------- inflate (after zlib's puff.c)

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// Canonical Huffman table from code lengths: count[len] and symbols sorted by (length, value).
function huffman(lengths, n) {
  const count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

let FIXED = null;
const fixedTables = () => {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  const d = new Uint8Array(30).fill(5);
  return (FIXED = { lit: huffman(l, 288), dist: huffman(d, 30) });
};

function inflateRaw(src, pos) {
  let bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4)), op = 0;

  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error("gunzip: unexpected end of data");
      bitBuf |= src[pos++] << bitCnt; bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n; bitCnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error("gunzip: invalid Huffman code");
  };
  const room = (extra) => {
    if (op + extra <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, op + extra));
    bigger.set(out.subarray(0, op));
    out = bigger;
  };

  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0; // drop the rest of the current byte
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      room(len);
      out.set(src.subarray(pos, pos + len), op);
      op += len; pos += len;
      continue;
    }
    let lit, dist;
    if (type === 1) ({ lit, dist } = fixedTables());
    else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
      const clTable = huffman(cl, 19);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(clTable);
        if (sym < 16) lengths[i++] = sym;
        else {
          let rep, val = 0;
          if (sym === 16) { if (i === 0) throw new Error("gunzip: bad repeat"); val = lengths[i - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > nlen + ndist) throw new Error("gunzip: bad code lengths");
          while (rep--) lengths[i++] = val;
        }
      }
      lit = huffman(lengths.subarray(0, nlen), nlen);
      dist = huffman(lengths.subarray(nlen), ndist);
    } else throw new Error("gunzip: invalid block type");

    for (;;) {
      const sym = decode(lit);
      if (sym < 256) { room(1); out[op++] = sym; }
      else if (sym === 256) break;
      else {
        const s = sym - 257;
        if (s >= 29) throw new Error("gunzip: invalid length symbol");
        const len = LEN_BASE[s] + bits(LEN_EXTRA[s]);
        const ds = decode(dist);
        if (ds >= 30) throw new Error("gunzip: invalid distance symbol");
        const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
        if (d > op) throw new Error("gunzip: distance too far back");
        room(len);
        for (let i = 0; i < len; i++, op++) out[op] = out[op - d];
      }
    }
  } while (!last);
  return out.subarray(0, op);
}

export function gunzip(u8) {
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) throw new Error("gunzip: not gzip data");
  if (u8[2] !== 8) throw new Error("gunzip: unknown compression method");
  const flags = u8[3];
  let p = 10;
  if (flags & 4) p += 2 + (u8[p] | (u8[p + 1] << 8));            // FEXTRA
  if (flags & 8) { while (u8[p++] !== 0); }                       // FNAME
  if (flags & 16) { while (u8[p++] !== 0); }                      // FCOMMENT
  if (flags & 2) p += 2;                                           // FHCRC
  return inflateRaw(u8, p);
}
