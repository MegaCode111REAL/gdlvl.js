// gdlvl.js — read, edit and write Geometry Dash .gdlvl files.
// Works in Node 18+ and browsers (ES module). Only dependency: fflate.
//
// File layout (verified against a real export):
//   .gdlvl  = base64url( gzip( plist XML ) )
//   plist   = flat <dict> of level fields (k2 name, k4 level data, k48 object count, ...)
//   k4      = base64url( gzip( "<header>;<obj>;<obj>;..." ) )
//   obj     = "key,value,key,value,..."   (key 1 = object ID, 2 = x, 3 = y, ...)
//
// Design rule: anything we don't understand is kept verbatim, so unknown
// fields and object properties survive a load/save round trip untouched.

import { gzip, gunzip } from "#codec"; // node: zlib, browser bundles: fflate (see package.json "imports")

const strToU8 = (s) => new TextEncoder().encode(s);
const strFromU8 = (b) => new TextDecoder().decode(b);

// ---------------------------------------------------------------- codec

export function b64urlDecode(s) {
  s = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
}

export const unpack = (text) => strFromU8(gunzip(b64urlDecode(text)));
export const pack = (str) => b64urlEncode(gzip(strToU8(str)));

// ---------------------------------------------------------------- plist (GD flavour)
// Nodes: { t: 'i'|'s'|'r'|'t'|'f'|'d'|'a', v }. 'd' -> v is [[key, node], ...]
// (ordered list, not a Map: GD allows repeated/ordered keys and we keep order.)
// 'a' -> v is [node, ...]. 't'/'f' (booleans) have no value.

const unesc = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function parsePlist(xml) {
  const head = xml.match(/^(.*?<plist[^>]*>)/s)?.[1] ?? '<?xml version="1.0"?><plist version="1.0" gjver="2.0">';
  const re = /<(\/?)([a-z]+)\s*(\/?)>|([^<]+)/g;
  re.lastIndex = head.length;
  let m;
  // next tag token; whitespace-only text between tags is skipped
  const next = () => {
    while ((m = re.exec(xml))) {
      if (m[4] !== undefined && m[4].trim() === "") continue;
      return m;
    }
    return null;
  };

  function readValue(tag, selfClose, closeTag = tag) {
    if (selfClose) return { t: tag === "t" || tag === "f" ? tag : "s", v: "" };
    if (tag === "d" || tag === "dict") {
      const entries = [];
      for (;;) {
        const tok = next();
        if (!tok || (tok[1] === "/" && tok[2] === closeTag)) break;
        if (tok[2] !== "k") throw new Error("plist: expected <k>, got " + tok[0]);
        const key = unesc(readText("k"));
        const vt = next();
        entries.push([key, readValue(vt[2], vt[3] === "/")]);
      }
      return { t: "d", v: entries };
    }
    if (tag === "a") {
      const items = [];
      for (;;) {
        const tok = next();
        if (!tok || (tok[1] === "/" && tok[2] === "a")) break;
        items.push(readValue(tok[2], tok[3] === "/"));
      }
      return { t: "a", v: items };
    }
    return { t: tag, v: unesc(readText(tag)) };
  }
  // read raw text up to the closing tag (our tokenizer drops pure-whitespace text)
  function readText(tag) {
    const close = `</${tag}>`;
    const start = re.lastIndex;
    const end = xml.indexOf(close, start);
    re.lastIndex = end + close.length;
    return xml.slice(start, end);
  }

  const root = next(); // <dict>
  if (root[2] !== "dict") throw new Error("plist: expected root <dict>");
  const dict = readValue("dict", false);
  dict.t = "d";
  return { head, dict };
}

function writePlist({ head, dict }) {
  const w = (n) => {
    switch (n.t) {
      case "d": return "<d>" + n.v.map(([k, v]) => `<k>${esc(k)}</k>${w(v)}`).join("") + "</d>";
      case "a": return "<a>" + n.v.map(w).join("") + "</a>";
      case "t": case "f": return `<${n.t} />`;
      default: return n.v === "" && n.t === "s" ? "<s></s>" : `<${n.t}>${esc(String(n.v))}</${n.t}>`;
    }
  };
  const body = "<dict>" + dict.v.map(([k, v]) => `<k>${esc(k)}</k>${w(v)}`).join("") + "</dict>";
  return head + body + "</plist>";
}

// ---------------------------------------------------------------- property names
// Human names for common object keys. Extend freely: unknown keys still work by number.
// Treat this table as a living data file; verify entries against levels you inspect.
export const PROPS = {
  id: 1, x: 2, y: 3, flipX: 4, flipY: 5, rotation: 6,
  r: 7, g: 8, b: 9, duration: 10, touchTriggered: 11,
  targetColor: 23, mainColor: 21, detailColor: 22,
  zLayer: 24, zOrder: 25, scale: 32,
  targetGroup: 51, groups: 57,
};
const KEY_TO_NAME = Object.fromEntries(Object.entries(PROPS).map(([n, k]) => [String(k), n]));
const keyOf = (k) => (typeof k === "number" ? String(k) : k in PROPS ? String(PROPS[k]) : k);

// ---------------------------------------------------------------- objects

export class GDObject {
  /** @param {[string,string][]} entries ordered key/value pairs (all strings) */
  constructor(entries = []) { this.entries = entries; }

  static parse(str) {
    const t = str.split(",");
    const e = [];
    for (let i = 0; i + 1 < t.length; i += 2) e.push([t[i], t[i + 1]]);
    return new GDObject(e);
  }
  toString() { return this.entries.map(([k, v]) => `${k},${v}`).join(","); }

  has(k) { k = keyOf(k); return this.entries.some(([ek]) => ek === k); }
  /** Raw string value, or undefined. Accepts a name ("x") or number (2). */
  getRaw(k) { k = keyOf(k); return this.entries.find(([ek]) => ek === k)?.[1]; }
  /** Numeric value when it looks numeric, else the raw string. */
  get(k) { const v = this.getRaw(k); return v !== undefined && v !== "" && !isNaN(v) ? Number(v) : v; }
  set(k, v) {
    k = keyOf(k); v = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    const e = this.entries.find(([ek]) => ek === k);
    if (e) e[1] = v; else this.entries.push([k, v]);
    return this;
  }
  delete(k) { k = keyOf(k); this.entries = this.entries.filter(([ek]) => ek !== k); return this; }

  // groups (key 57) are stored dot-separated: "1.2.3"
  get groupList() { return (this.getRaw(57) ?? "").split(".").filter(Boolean).map(Number); }
  addGroup(g) { const s = new Set(this.groupList); s.add(g); this.set(57, [...s].join(".")); return this; }
  removeGroup(g) {
    const l = this.groupList.filter((x) => x !== g);
    l.length ? this.set(57, l.join(".")) : this.delete(57);
    return this;
  }

  /** Friendly view for debugging: { id: 1, x: 225, y: 15, "155": 1 } */
  toJSON() {
    return Object.fromEntries(this.entries.map(([k, v]) => [KEY_TO_NAME[k] ?? k, isNaN(v) || v === "" ? v : Number(v)]));
  }
}

// ---------------------------------------------------------------- level

export class Level {
  constructor(plist, headerTokens, objects) {
    this._plist = plist;
    this.headerTokens = headerTokens; // ["kS38", "<colors>", "kA13", "0", ...] kept verbatim
    this.objects = objects;           // GDObject[]
  }

  static fromFileText(text) {
    const plist = parsePlist(unpack(text));
    const level = new Level(plist, [], []);
    const k4 = level._field("k4");
    if (k4 == null) throw new Error("No k4 (level data) field found");
    const data = unpack(k4.v);
    const [header, ...objs] = data.split(";");
    level.headerTokens = header.split(",");
    level.objects = objs.filter((s) => s.length).map(GDObject.parse);
    return level;
  }

  toFileText() {
    const data = [this.headerTokens.join(","), ...this.objects.map((o) => o.toString())].join(";") + ";";
    this._field("k4").v = pack(data);
    const count = this._field("k48");               // object count; keep in sync
    if (count) count.v = String(this.objects.length);
    return pack(writePlist(this._plist));
  }

  // --- level-level fields (name, camera, etc.)
  _field(key) { return this._plist.dict.v.find(([k]) => k === key)?.[1]; }
  get name() { return this._field("k2")?.v; }
  set name(v) { this._field("k2").v = v; }
  /** Any top-level plist field, e.g. level.field("k80"). */
  field(key, value) {
    const f = this._field(key);
    if (value === undefined) return f?.v;
    if (!f) this._plist.dict.v.push([key, { t: typeof value === "number" ? (Number.isInteger(value) ? "i" : "r") : "s", v: String(value) }]);
    else f.v = String(value);
  }

  // --- header (kS38 colour channels etc.)
  headerGet(key) { const i = this.headerTokens.indexOf(key); return i < 0 ? undefined : this.headerTokens[i + 1]; }
  headerSet(key, value) {
    const i = this.headerTokens.indexOf(key);
    if (i < 0) this.headerTokens.push(key, String(value)); else this.headerTokens[i + 1] = String(value);
  }

  /** Colour channels as an array of { raw, props: Map }. Channel id is key "6". */
  get colors() {
    return (this.headerGet("kS38") ?? "").split("|").filter(Boolean).map((raw) => {
      const t = raw.split("_"), e = [];
      for (let i = 0; i + 1 < t.length; i += 2) e.push([t[i], t[i + 1]]);
      return e;
    });
  }
  set colors(list) {
    this.headerSet("kS38", list.map((e) => e.map(([k, v]) => `${k}_${v}`).join("_")).join("|") + "|");
  }
  /** Set RGB (0-255) on a channel id (1000=BG, 1001=ground, 1004=object, 1005/1006=players, ...). Creates it if missing. */
  setColor(channelId, r, g, b, { opacity, blending } = {}) {
    const list = this.colors;
    let ch = list.find((e) => e.some(([k, v]) => k === "6" && v === String(channelId)));
    if (!ch) {
      ch = [["1", "255"], ["2", "255"], ["3", "255"], ["11", "255"], ["12", "255"], ["13", "255"],
            ["4", "-1"], ["6", String(channelId)], ["7", "1"], ["15", "1"], ["18", "0"], ["8", "1"]];
      list.push(ch);
    }
    const set = (k, v) => { const e = ch.find(([ek]) => ek === k); e ? (e[1] = String(v)) : ch.push([k, String(v)]); };
    set("1", r); set("2", g); set("3", b);
    if (opacity !== undefined) set("7", opacity);
    if (blending !== undefined) set("5", blending ? 1 : 0);
    this.colors = list;
    return this;
  }

  // --- object editing
  /** Add an object. props may use names or numbers: add(8, 300, 15, { rotation: 90, groups: "1.2" }) */
  add(id, x, y, props = {}) {
    const o = new GDObject();
    o.set(1, id).set(2, x).set(3, y);
    for (const [k, v] of Object.entries(props)) o.set(k, v);
    this.objects.push(o);
    return o;
  }
  /** Objects matching a predicate or a {x, y, id,...} shape. */
  find(q) { return this.objects.filter(matcher(q)); }
  /** Delete matching objects; returns how many were removed. */
  remove(q) {
    const m = matcher(q), before = this.objects.length;
    this.objects = this.objects.filter((o) => !m(o));
    return before - this.objects.length;
  }
  /** Apply props to all matching objects. */
  update(q, props) { const hits = this.find(q); for (const o of hits) for (const [k, v] of Object.entries(props)) o.set(k, v); return hits.length; }
  /** Move matching objects by (dx, dy). */
  move(q, dx, dy) { const hits = this.find(q); for (const o of hits) { o.set("x", o.get("x") + dx); o.set("y", o.get("y") + dy); } return hits.length; }
}

function matcher(q) {
  if (typeof q === "function") return q;
  const entries = Object.entries(q);
  return (o) => entries.every(([k, v]) => o.get(k) === v);
}

/** Axis-aligned selection helper: objects with x0<=x<=x1 and y0<=y<=y1. */
export const inRect = (x0, y0, x1, y1) => (o) => {
  const x = o.get("x"), y = o.get("y");
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
};
