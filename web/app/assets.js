// Sprites for objects: the placeholders in web/assets/, custom art from web/assets/objects/ (listed
// in manifest.json), and files the user loads at runtime. See web/assets/README.md.
import { objectName, classOf } from "../../src/gdlvl.js";
import { kvGet, kvSet, kvDel } from "./idb.js";

/** Which placeholder shape suits an object, guessed from its name and class. */
export function kindOf(id) {
  const name = (objectName(id) ?? "").toLowerCase();
  const cls = classOf(id);
  if (cls === "TextObject" || /\btext\b/.test(name)) return "text";
  if (/start position/.test(name)) return "start";
  if (cls.endsWith("Trigger") || /trigger/.test(name)) return "trigger";
  if (/portal/.test(name)) return "portal";
  if (/\bpad\b/.test(name)) return "pad";
  if (/\borb\b/.test(name) || cls === "Collectible") return "orb";
  if (/saw|blade|gear|wheel|cartwheel|rotating/.test(name)) return "saw";
  if (/spike|thorn/.test(name)) return /half/.test(name) ? "halfspike" : "spike";
  if (/slope/.test(name)) return /wide/.test(name) ? "wideslope" : "slope";
  if (/slab/.test(name)) return "slab";
  if (/\b(block|square|tile|brick|bricks)\b/.test(name)) return "block";
  if (/decorative|cloud|chain|bush|grass|flower|swirl|shine|water|equalizer|rod|glow|pipe/.test(name)) return "deco";
  return "block";
}

function sizeFactor(id, kind) {
  const n = (objectName(id) ?? "").toLowerCase();
  if (["block", "slab", "spike", "halfspike", "slope", "wideslope"].includes(kind)) return /small|tiny/.test(n) ? 0.5 : 1;
  if (kind === "saw" || kind === "deco") return /tiny|very small/.test(n) ? 0.5 : /small/.test(n) ? 0.75 : /very large/.test(n) ? 2 : /large/.test(n) ? 1.5 : 1;
  return 1;
}

const FILE_RE = /^(\d+)(?:_(detail|fixed))?\.(png|webp|svg|gif|jpe?g)$/i;

export class Assets {
  constructor(base = "../assets/") {
    this.base = new URL(base, import.meta.url).href;
    this.manifest = { pxPerUnit: 4, placeholders: {}, objects: {} };
    this.images = new Map();   // url -> { img, ready, failed }
    this.cache = new Map();    // object id -> sprite
    this.pack = new Map();     // runtime-loaded art: id -> { base, detail, fixed } (blob URLs)
    this.packPx = 4;
    this.packCount = 0;
    this.onUpdate = () => {};
  }

  async load() {
    const res = await fetch(new URL("manifest.json", this.base));
    if (!res.ok) throw new Error(`Could not load assets/manifest.json (${res.status}). Run: npm run build:assets`);
    this.manifest = await res.json();
    this.manifest.objects ??= {};
    await this.restorePack();
  }

  image(url) {
    let e = this.images.get(url);
    if (!e) {
      const img = new Image();
      e = { img, ready: false, failed: false };
      img.onload = () => { e.ready = true; this.cache.clear(); this.onUpdate(); };
      img.onerror = () => { e.failed = true; this.cache.clear(); this.onUpdate(); };
      img.src = url;
      this.images.set(url, e);
    }
    return e;
  }

  /** { w, h (game units), layers: [{ entry, tint: "c1" | "c2" | null }], custom, kind } */
  sprite(id) {
    let s = this.cache.get(id);
    if (s) return s;
    const key = String(id);
    const fromPack = this.pack.get(key);
    const custom = fromPack ?? this.manifest.objects[key];
    if (custom) {
      const ppu = fromPack ? this.packPx : this.manifest.pxPerUnit;
      const url = (p) => (fromPack ? p : new URL(p, this.base).href);
      const layers = [];
      if (custom.base) layers.push({ entry: this.image(url(custom.base)), tint: "c1" });
      if (custom.detail) layers.push({ entry: this.image(url(custom.detail)), tint: "c2" });
      if (custom.fixed) layers.push({ entry: this.image(url(custom.fixed)), tint: null });
      const live = layers.filter((l) => !l.entry.failed);
      if (live.length) {
        const ref = live.find((l) => l.entry.ready);
        if (!ref) return this.placeholder(id, live); // still loading: placeholder size, not cached
        const { naturalWidth: w, naturalHeight: h } = ref.entry.img;
        s = { w: w / ppu, h: h / ppu, layers: live, custom: true, kind: "custom" };
        this.cache.set(id, s);
        return s;
      }
    }
    s = this.placeholder(id);
    this.cache.set(id, s);
    return s;
  }

  placeholder(id, loadingLayers) {
    const kind = kindOf(id);
    const p = this.manifest.placeholders[kind] ?? this.manifest.placeholders.block;
    const f = sizeFactor(id, kind);
    const layers = loadingLayers ? [] : p ? [{ entry: this.image(new URL(p.file, this.base).href), tint: p.tint ? "c1" : null }] : [];
    return { w: (p?.size[0] ?? 30) * f, h: (p?.size[1] ?? 30) * f, layers, custom: false, kind };
  }

  /** URL of an image to show in lists (the base layer, or the placeholder). */
  thumb(id) {
    const key = String(id);
    const fromPack = this.pack.get(key);
    const custom = fromPack ?? this.manifest.objects[key];
    const file = custom?.base ?? custom?.fixed ?? custom?.detail;
    if (file) return fromPack ? file : new URL(file, this.base).href;
    const p = this.manifest.placeholders[kindOf(id)] ?? this.manifest.placeholders.block;
    return p ? new URL(p.file, this.base).href : "";
  }

  // ---- art loaded at runtime (files named like the ones in web/assets/objects/) ----------------

  /** Load image files named "<id>.png", "<id>_detail.png", "<id>_fixed.png" (+ optional manifest.json). */
  async loadPackFiles(files, { persist = true } = {}) {
    const items = [...files];
    for (const url of [...this.pack.values()].flatMap((o) => Object.values(o))) URL.revokeObjectURL(url);
    const next = new Map();
    let px = 4, count = 0;
    const keep = [];
    for (const f of items) {
      const name = f.name.split("/").pop();
      if (name.toLowerCase() === "manifest.json") {
        try { px = Number(JSON.parse(await f.text()).pxPerUnit) || 4; keep.push(f); } catch { /* ignore a bad manifest */ }
        continue;
      }
      const m = name.match(FILE_RE);
      if (!m) continue;
      const slot = (next.get(m[1]) ?? next.set(m[1], {}).get(m[1]));
      slot[m[2] ?? "base"] = URL.createObjectURL(f);
      keep.push(f); count++;
    }
    this.pack = next; this.packPx = px; this.packCount = count;
    this.images.clear(); this.cache.clear();
    if (persist) {
      if (count) await kvSet("pack", { px, files: await Promise.all(keep.map(async (f) => ({ name: f.name.split("/").pop(), type: f.type, buf: await f.arrayBuffer() }))) });
      else await kvDel("pack");
    }
    this.onUpdate();
    return count;
  }

  async restorePack() {
    const saved = await kvGet("pack");
    if (!saved?.files?.length) return 0;
    const files = saved.files.map((f) => new File([f.buf], f.name, { type: f.type }));
    return this.loadPackFiles(files, { persist: false });
  }

  async clearPack() {
    for (const url of [...this.pack.values()].flatMap((o) => Object.values(o))) URL.revokeObjectURL(url);
    this.pack = new Map(); this.packCount = 0;
    this.images.clear(); this.cache.clear();
    await kvDel("pack");
    this.onUpdate();
  }
}
