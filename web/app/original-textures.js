// Original Geometry Dash atlas support. Uses the matching TexturePacker plist for every sheet.
// Sprite-sheet files are in ../../data/spritesheets; placeholders remain the fallback when a
// frame cannot be confidently associated with an object ID.
import { objectName, classOf } from "../../src/gdlvl.js";
import { kvGet, kvSet } from "./idb.js";

const SHEETS = [
  ["GJ_GameSheet-uhd", "../../data/spritesheets/GJ_GameSheet-uhd.png", "../../data/spritesheets/GJ_GameSheet-uhd.plist"],
  ["GJ_GameSheet02-uhd", "../../data/spritesheets/GJ_GameSheet02-uhd.png", "../../data/spritesheets/GJ_GameSheet02-uhd.plist"],
  ["GJ_GameSheet03-uhd", "../../data/spritesheets/GJ_GameSheet03-uhd.png", "../../data/spritesheets/GJ_GameSheet03-uhd.plist"],
];
const NUMBER = /-?\d+(?:\.\d+)?/g;
const parsePoint = (value) => (String(value ?? "").match(NUMBER) ?? []).map(Number);

function plistValue(dict, key) {
  const children = [...dict.children];
  const i = children.findIndex((node) => node.tagName === "key" && node.textContent === key);
  return i < 0 ? null : children[i + 1] ?? null;
}
function plistString(dict, key) { return plistValue(dict, key)?.textContent ?? ""; }
function plistBool(dict, key) { return plistValue(dict, key)?.tagName === "true"; }

function parseFrames(xml, sheetName, image) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`Invalid plist for ${sheetName}`);
  const root = doc.querySelector("plist > dict");
  const framesDict = plistValue(root, "frames");
  if (!framesDict || framesDict.tagName !== "dict") throw new Error(`No frames dictionary in ${sheetName}.plist`);
  const children = [...framesDict.children], frames = new Map();
  for (let i = 0; i < children.length; i += 2) {
    const name = children[i]?.textContent;
    const d = children[i + 1];
    if (!name || d?.tagName !== "dict") continue;
    const rect = parsePoint(plistString(d, "textureRect"));
    const source = parsePoint(plistString(d, "spriteSourceSize"));
    const offset = parsePoint(plistString(d, "spriteOffset"));
    if (rect.length < 4 || source.length < 2 || offset.length < 2) continue;
    const rotated = plistBool(d, "textureRotated");
    const [x, y, packedW, packedH] = rect;
    const cropW = rotated ? packedH : packedW;
    const cropH = rotated ? packedW : packedH;
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, cropW); crop.height = Math.max(1, cropH);
    const cg = crop.getContext("2d");
    if (rotated) {
      // TexturePacker stores rotated frames with their packed width/height swapped.
      // Draw the packed rectangle into the correctly swapped destination before rotating it
      // back into the frame's unrotated orientation.
      cg.translate(cropW / 2, cropH / 2);
      cg.rotate(-Math.PI / 2);
      cg.drawImage(image, x, y, packedW, packedH, -cropH / 2, -cropW / 2, cropH, cropW);
    } else {
      cg.drawImage(image, x, y, packedW, packedH, 0, 0, cropW, cropH);
    }
    const realW = rotated ? source[1] : source[0];
    const realH = rotated ? source[0] : source[1];
    const offX = rotated ? offset[1] : offset[0];
    const offY = rotated ? offset[0] : offset[1];
    const out = document.createElement("canvas");
    out.width = Math.max(1, realW); out.height = Math.max(1, realH);
    const ox = Math.floor((realW - cropW) / 2 + offX);
    const oy = Math.floor((realH - cropH) / 2 + offY);
    out.getContext("2d").drawImage(crop, ox, oy);
    frames.set(name, { name, sheetName, canvas: out, w: out.width / 4, h: out.height / 4, dataUrl: null });
  }
  return frames;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

const FRAME_SUFFIX = /(?:_color)?_?\d{3}\.png$/i;
function baseFrameName(name) { return name.replace(FRAME_SUFFIX, "").toLowerCase(); }
function scoreFrame(frameName, name, id, cls) {
  const f = baseFrameName(frameName), n = name.toLowerCase();
  if (/_color_/i.test(frameName) || f.includes("glow") || f.startsWith("d_")) return -100;
  let score = 0;
  const pairs = [
    [/spike|thorn/, /spike|thorn|hazard/],
    [/saw|blade|gear|wheel/, /saw|blade|gear|wheel|cog/],
    [/orb|ring|collectible/, /ring|orb|coin/],
    [/pad|spring|jump pad/, /pad|boost/],
    [/portal/, /portal|gate/],
    [/ship/, /ship/], [/cube|square|block|tile|brick/, /block\d|square|cube/],
    [/robot/, /robot/], [/wave/, /wave/], [/ball/, /ball/], [/ufo/, /bird|ufo/],
    [/slope/, /slope/], [/swing/, /swing/], [/dash/, /dash/],
  ];
  for (const [objectRe, frameRe] of pairs) if (objectRe.test(n) && frameRe.test(f)) score += 8;
  const tokens = n.replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((t) => t.length > 2 && !["black", "blue", "yellow", "pink", "green", "red", "small", "large", "color", "colour", "object", "portal"].includes(t));
  for (const t of tokens) if (f.includes(t)) score += 3;
  if (cls.endsWith("Trigger") && /trigger|edit_e/.test(f)) score += 5;
  if (/decorative|decoration|grass|bush|flower|cloud|chain/.test(n) && /deco|bush|grass|flower|cloud|chain|plant/.test(f)) score += 7;
  if (/^block\d{3}_\d{2}$/.test(f) && id >= 1 && id <= 7) score += 20;
  return score;
}

export class OriginalTextures {
  constructor() {
    this.frames = new Map();
    this.bySheet = new Map();
    this.enabled = true;
    this.ready = false;
    this.error = "";
    this.mapping = new Map([
      [1, "block001_01_001.png"], [2, "block001_02_001.png"], [3, "block001_03_001.png"],
      [4, "block001_04_001.png"], [5, "block001_05_001.png"], [6, "block001_06_001.png"],
      [7, "block001_07_001.png"], [8, "spike_01_001.png"], [9, "invis_spike_01_001.png"],
    ]);
    this.resolved = new Map();
    this.count = 0;
  }

  async load() {
    const errors = [];
    for (const [sheetName, pngPath, plistPath] of SHEETS) {
      try {
        const pngUrl = new URL(pngPath, import.meta.url);
        const plistUrl = new URL(plistPath, import.meta.url);
        const [img, response] = await Promise.all([
          loadImage(pngUrl.href),
          fetch(plistUrl.href).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }),
        ]);
        const frames = parseFrames(response, sheetName, img);
        this.bySheet.set(sheetName, frames);
        for (const [name, frame] of frames) if (!this.frames.has(name)) this.frames.set(name, frame);
      } catch (e) { errors.push(`${sheetName}: ${e.message}`); }
    }
    this.count = this.frames.size;
    const savedMap = await kvGet("originalFrameMap");
    if (Array.isArray(savedMap)) for (const [id, frameName] of savedMap) if (this.frames.has(frameName)) this.mapping.set(Number(id), frameName);
    this.ready = this.count > 0;
    this.error = errors.join("; ");
    if (!this.ready) throw new Error("Original Geometry Dash textures could not be loaded. " + this.error);
    return this.count;
  }

  frameFor(id) {
    if (!this.ready || !this.enabled) return null;
    id = Number(id);
    const cached = this.resolved.get(id);
    if (cached !== undefined) return cached;
    const explicit = this.mapping.get(id);
    if (explicit && this.frames.has(explicit)) {
      const result = this.layered(explicit);
      this.resolved.set(id, result);
      return result;
    }
    // Do not guess: the atlas contains many similar sprites and name-based matching
    // assigns unrelated textures to object IDs. Use verified mappings only.
    const result = null;
    this.resolved.set(id, result);
    return result;
  }

  layered(frameName) {
    const frame = this.frames.get(frameName);
    if (!frame) return null;
    const root = frameName.replace(/_001\.png$/i, "");
    const colorFrame = this.frames.get(root + "_color_001.png");
    const layers = [{ entry: { img: frame.canvas, ready: true, failed: false }, tint: "c1" }];
    if (colorFrame) layers.push({ entry: { img: colorFrame.canvas, ready: true, failed: false }, tint: "c2" });
    return { w: frame.w, h: frame.h, layers, custom: true, kind: "original", frameName, original: true };
  }

  thumb(id) {
    const sprite = this.frameFor(id);
    if (!sprite?.layers?.length) return null;
    const canvas = sprite.layers[0].entry.img;
    const frame = [...this.frames.values()].find((f) => f.canvas === canvas);
    if (!frame) return null;
    if (!frame.dataUrl) frame.dataUrl = canvas.toDataURL("image/png");
    return frame.dataUrl;
  }

  async setMapping(id, frameName) {
    id = Number(id);
    if (!Number.isInteger(id) || id < 1 || !this.frames.has(frameName)) throw new Error("Choose a valid object ID and atlas frame.");
    this.mapping.set(id, frameName);
    this.resolved.delete(id);
    await kvSet("originalFrameMap", [...this.mapping.entries()]);
  }

  async clearMapping(id) {
    id = Number(id);
    this.mapping.delete(id);
    this.resolved.delete(id);
    await kvSet("originalFrameMap", [...this.mapping.entries()]);
  }

  frameNames(query = "") {
    const q = query.trim().toLowerCase();
    const names = [...this.frames.keys()];
    return q ? names.filter((name) => name.toLowerCase().includes(q)).slice(0, 150) : [];
  }

  setEnabled(enabled) { this.enabled = !!enabled; this.resolved.clear(); }
}

export async function installOriginalTextures(assets) {
  const original = new OriginalTextures();
  try {
    await original.load();
    console.info(`[gdlvl] loaded ${original.count} original Geometry Dash atlas frames`);
  } catch (e) {
    original.error = e?.message || String(e);
    console.error("[gdlvl] original textures unavailable:", e);
  }
  const baseSprite = assets.sprite.bind(assets);
  const baseThumb = assets.thumb.bind(assets);
  assets.originalTextures = original;
  assets.sprite = (id) => original.frameFor(id) ?? baseSprite(id);
  assets.thumb = (id) => original.thumb(id) ?? baseThumb(id);
  const oldUpdate = assets.onUpdate;
  assets.onUpdate = () => { oldUpdate?.(); assets.onUpdateList?.(); };
  assets.originalTexturesChanged = () => { original.resolved.clear(); assets.cache.clear(); assets.onUpdate(); assets.onUpdateList?.(); };
  return original;
}
