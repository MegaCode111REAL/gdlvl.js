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

import { gzip, gunzip } from "#codec";
import { classOf, fieldsOf, decodeValue, encodeValue } from "./schema.js";
export { classOf, fieldsOf, idsForClass, classNames, resolveType } from "./schema.js";
import { objectName } from "./names.js";
export { objectName, findObjects, objectCount } from "./names.js"; // node: zlib, browser bundles: fflate (see package.json "imports")

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
// Property names come from the schema (src/schema.js): each object's class (decided by its
// object ID, key 1) says which keys exist, what they are called, and their types.
// So `obj.set("move_x", 120)` works on a Move trigger but throws on a block.
// A few older/short names are accepted as aliases. Schema names always win.
export const ALIASES = {
  id: 1, flipX: 4, flipY: 5, r: 7, g: 8, b: 9,
  touchTriggered: 11, targetColor: 23, mainColor: 21, detailColor: 22,
  zLayer: 24, zOrder: 25, targetGroup: 51,
};
const ID_FIELD = { name: "id", id: 1, type: "Int", note: "object ID" };

const norm = (s) => s.toLowerCase().replace(/_/g, "");
const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
// Near-miss names: same letters ignoring case/underscores first, then substring matches.
const suggest = (name, names) => {
  const n = norm(name);
  const exact = names.filter((x) => norm(x) === n);
  if (exact.length) return exact;
  return names.filter((x) => norm(x).includes(n) || (norm(x).length >= 3 && n.includes(norm(x)))).slice(0, 5);
};

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

  /** Object ID (key 1), or undefined. */
  get objectId() { const v = this.entries.find(([k]) => k === "1")?.[1]; return v === undefined ? undefined : Number(v); }
  /** Schema class for this object, e.g. "MoveTrigger" (unlisted IDs are "Common"). */
  get className() { return classOf(this.objectId); }
  /** Display name for this object's ID, e.g. "Black Gradient Spike" (undefined if the ID has no name). */
  get name() { return objectName(this.objectId); }

  // Resolve a name or number to { key, field }. Unknown names return null, or throw when writing.
  _lookup(k, write = false) {
    const fields = fieldsOf(this.className);
    if (typeof k === "number" || /^\d+$/.test(k)) {
      const key = String(k);
      return { key, field: key === "1" ? ID_FIELD : fields.byKey.get(key) };
    }
    if (k === "id") return { key: "1", field: ID_FIELD };
    const f = fields.byName.get(k);
    if (f) return { key: String(f.id), field: f };
    if (k in ALIASES) { const key = String(ALIASES[k]); return { key, field: fields.byKey.get(key) }; }
    const snake = fields.byName.get(toSnake(k)); // camelCase works too: moveX -> move_x
    if (snake) return { key: String(snake.id), field: snake };
    if (!write) return null;
    const hint = suggest(k, [...fields.byName.keys()]);
    throw new Error(`Unknown property "${k}" for ${this.className} (object ${this.objectId})` +
      (hint.length ? `. Did you mean: ${hint.join(", ")}?` : "") + ` You can also use the raw key number.`);
  }

  has(k) { const l = this._lookup(k); return !!l && this.entries.some(([ek]) => ek === l.key); }
  /** Raw string value as stored in the file, or undefined. Accepts a name ("x") or number (2). */
  getRaw(k) { const l = this._lookup(k); return l ? this.entries.find(([ek]) => ek === l.key)?.[1] : undefined; }
  /** Typed value: numbers for Int/Float, booleans for Bool, number[] for group lists, variant names for enums. */
  get(k) {
    const l = this._lookup(k);
    if (!l) return undefined;
    const raw = this.entries.find(([ek]) => ek === l.key)?.[1];
    if (raw === undefined) return l.field?.type === "Bool" ? false : undefined;
    if (!l.field) return raw !== "" && !isNaN(raw) ? Number(raw) : raw;
    return decodeValue(l.field.type, raw);
  }
  /** Set a property by schema name or key number. Throws on a name this object's class doesn't have. */
  set(k, v) {
    const { key, field } = this._lookup(k, true);
    const raw = field ? encodeValue(field.type, v) : typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    const e = this.entries.find(([ek]) => ek === key);
    if (e) e[1] = raw; else this.entries.push([key, raw]);
    return this;
  }
  delete(k) { const l = this._lookup(k); if (l) this.entries = this.entries.filter(([ek]) => ek !== l.key); return this; }

  // groups (key 57) are stored dot-separated: "1.2.3"
  get groupList() { return (this.getRaw(57) ?? "").split(".").filter(Boolean).map(Number); }
  addGroup(g) { const s = new Set(this.groupList); s.add(g); this.set(57, [...s].join(".")); return this; }
  removeGroup(g) {
    const l = this.groupList.filter((x) => x !== g);
    l.length ? this.set(57, l.join(".")) : this.delete(57);
    return this;
  }

  /** Keys stored on this object that its class doesn't define (kept on save, but worth a look). */
  unknownKeys() {
    const { byKey } = fieldsOf(this.className);
    return this.entries.map(([k]) => k).filter((k) => k !== "1" && !byKey.has(k));
  }

  /** Every property this object's class supports, with current values. Handy for building a property panel. */
  properties() {
    const { byName } = fieldsOf(this.className);
    return [...byName.values()].map((f) => ({
      name: f.name, key: f.id, type: f.type, note: f.note,
      isSet: this.has(f.id), value: this.get(f.id),
    }));
  }

  /** Friendly view: { id: 901, x: 300, y: 105, target_group: 3 }. Unknown keys appear by number. */
  toJSON() {
    return Object.fromEntries(this.entries.map(([k, raw]) => {
      const { field } = this._lookup(k);
      return [field?.name ?? k, field ? decodeValue(field.type, raw) : raw !== "" && !isNaN(raw) ? Number(raw) : raw];
    }));
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
  /** Report objects holding keys their class doesn't define: [{ index, id, className, unknown: ["155", ...] }]. */
  validate() {
    return this.objects.flatMap((o, index) => {
      const unknown = o.unknownKeys();
      return unknown.length ? [{ index, id: o.objectId, className: o.className, unknown }] : [];
    });
  }
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
  // A plain value must equal the property; for group lists, {groups: 5} means "is in group 5".
  return (o) => entries.every(([k, v]) => {
    const a = o.get(k);
    if (Array.isArray(a)) return Array.isArray(v) ? JSON.stringify(a) === JSON.stringify(v) : a.includes(v);
    return a === v;
  });
}

/** Axis-aligned selection helper: objects with x0<=x<=x1 and y0<=y<=y1. */
export const inRect = (x0, y0, x1, y1) => (o) => {
  const x = o.get("x"), y = o.get("y");
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
};
