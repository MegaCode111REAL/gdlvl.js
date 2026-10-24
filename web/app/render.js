// Canvas renderer. World coordinates are game units with y pointing up; one block is 30 units and
// the ground is y = 0. Objects are parsed straight from their raw key/value pairs each frame,
// which is much faster than going through the schema for every property of every object.

const D2R = Math.PI / 180;
const WHITE = { r: 255, g: 255, b: 255, a: 1, add: false };

/** Pull the drawing-related properties out of an object in one pass over its entries. */
export function parseObj(o) {
  const p = { id: 0, x: 0, y: 0, rot: 0, fh: false, fv: false, sc: 1, sx: 1, sy: 1, c1: 0, c2: 0, zl: 0, zo: 0 };
  const e = o.entries;
  for (let i = 0; i < e.length; i++) {
    const v = e[i][1];
    switch (e[i][0]) {
      case "1": p.id = +v; break;
      case "2": p.x = +v; break;
      case "3": p.y = +v; break;
      case "4": p.fh = v === "1"; break;
      case "5": p.fv = v === "1"; break;
      case "6": p.rot = +v; break;
      case "32": p.sc = +v || 1; break;
      case "128": p.sx = +v || 1; break;
      case "129": p.sy = +v || 1; break;
      case "21": p.c1 = +v; break;
      case "22": p.c2 = +v; break;
      case "24": p.zl = +v; break;
      case "25": p.zo = +v; break;
    }
  }
  return p;
}

/** Colour channels from the level header: Map<channel id, { r, g, b, a, add }>. */
export function channelMap(level) {
  const m = new Map();
  for (const entry of level.colors) {
    const d = Object.fromEntries(entry);
    m.set(Number(d["6"]), { r: +d["1"], g: +d["2"], b: +d["3"], a: d["7"] !== undefined ? +d["7"] : 1, add: d["5"] === "1" });
  }
  return m;
}

export class Renderer {
  constructor(canvas, store, assets) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d");
    this.store = store; this.assets = assets;
    this.view = { cx: 300, cy: 120, zoom: 2 };
    this.opts = { showIds: true, grid: true };
    this.ghost = null;     // { id, x, y } while placing from the palette
    this.box = null;       // { x0, y0, x1, y1 } while box-selecting (world units)
    this.tintCache = new Map();
    this.order = []; this.orderRev = -1;
    this.dirty = true; this.dpr = 1;
    assets.onUpdate = () => this.requestDraw();
    this.loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } requestAnimationFrame(this.loop); };
    requestAnimationFrame(this.loop);
  }

  requestDraw() { this.dirty = true; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.requestDraw();
  }

  // CSS-pixel <-> world conversions (relative to the canvas element)
  toWorld(px, py) {
    const { cx, cy, zoom } = this.view, r = this.canvas.getBoundingClientRect();
    return { x: cx + (px - r.width / 2) / zoom, y: cy - (py - r.height / 2) / zoom };
  }
  toScreen(x, y) {
    const { cx, cy, zoom } = this.view, r = this.canvas.getBoundingClientRect();
    return { x: (x - cx) * zoom + r.width / 2, y: r.height / 2 - (y - cy) * zoom };
  }

  zoomAt(px, py, factor) {
    const before = this.toWorld(px, py);
    this.view.zoom = Math.min(10, Math.max(0.04, this.view.zoom * factor));
    const after = this.toWorld(px, py);
    this.view.cx += before.x - after.x; this.view.cy += before.y - after.y;
    this.requestDraw();
  }

  pan(dxPx, dyPx) { this.view.cx -= dxPx / this.view.zoom; this.view.cy += dyPx / this.view.zoom; this.requestDraw(); }

  fit() {
    const objs = this.store.level.objects;
    const r = this.canvas.getBoundingClientRect();
    if (!objs.length) { this.view = { cx: 300, cy: 120, zoom: 2 }; this.requestDraw(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of objs) { const p = parseObj(o); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    x0 -= 30; x1 += 30; y0 = Math.min(y0, 0) - 30; y1 += 30;
    this.view.zoom = Math.min(10, Math.max(0.04, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
    this.view.cx = (x0 + x1) / 2; this.view.cy = (y0 + y1) / 2;
    this.requestDraw();
  }

  /** Objects in draw order (z layer, z order, then file order). Rebuilt only when the order can change. */
  getOrder() {
    if (this.orderRev === this.store.orderRev && this.order.length === this.store.level.objects.length) return this.order;
    this.order = this.store.level.objects
      .map((o, i) => { const p = parseObj(o); return { o, zl: p.zl, zo: p.zo, i }; })
      .sort((a, b) => a.zl - b.zl || a.zo - b.zo || a.i - b.i)
      .map((e) => e.o);
    this.orderRev = this.store.orderRev;
    return this.order;
  }

  tinted(entry, c) {
    const img = entry.img;
    const key = `${img.src}|${c.r},${c.g},${c.b}`;
    let t = this.tintCache.get(key);
    if (!t) {
      if (this.tintCache.size > 3000) this.tintCache.clear();
      t = document.createElement("canvas");
      t.width = img.naturalWidth || 120; t.height = img.naturalHeight || 120;
      const g = t.getContext("2d");
      g.drawImage(img, 0, 0, t.width, t.height);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      g.fillRect(0, 0, t.width, t.height);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(img, 0, 0, t.width, t.height);
      this.tintCache.set(key, t);
    }
    return t;
  }

  /** The object under a world point (topmost first), or null. */
  pick(x, y) {
    const order = this.getOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const o = order[i], p = parseObj(o), s = this.assets.sprite(p.id);
      const th = p.rot * D2R, c = Math.cos(th), sn = Math.sin(th), dx = x - p.x, dy = y - p.y;
      const lx = (dx * c - dy * sn) / (p.sx * p.sc), ly = (dx * sn + dy * c) / (p.sy * p.sc);
      if (Math.abs(lx) <= s.w / 2 && Math.abs(ly) <= s.h / 2) return o;
    }
    return null;
  }

  /** Objects whose centre lies inside a world rectangle. */
  inRect(x0, y0, x1, y1) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    return this.store.level.objects.filter((o) => { const p = parseObj(o); return p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy; });
  }

  draw() {
    const { ctx, canvas, view, assets, store } = this;
    const dpr = this.dpr, W = canvas.width, H = canvas.height, z = view.zoom * dpr;
    const chs = channelMap(store.level);
    const col = (id) => chs.get(id) ?? WHITE;
    const sxOf = (x) => (x - view.cx) * z + W / 2, syOf = (y) => H / 2 - (y - view.cy) * z;
    const left = view.cx - W / 2 / z, right = view.cx + W / 2 / z, bottom = view.cy - H / 2 / z, top = view.cy + H / 2 / z;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    const bg = col(1000), gr = col(1001);
    ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
    ctx.fillRect(0, 0, W, H);

    // ground
    const gy = syOf(0);
    if (gy < H) {
      ctx.fillStyle = `rgb(${gr.r >> 1},${gr.g >> 1},${gr.b >> 1})`;
      ctx.fillRect(0, Math.max(0, gy), W, H - Math.max(0, gy));
    }

    // grid (30-unit cells, stronger line every 5 blocks)
    if (this.opts.grid && z * 30 >= 6 * dpr) {
      ctx.lineWidth = dpr;
      for (let gx = Math.floor(left / 30) * 30; gx <= right; gx += 30) {
        ctx.strokeStyle = Math.round(gx / 30) % 5 === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.07)";
        const px = Math.round(sxOf(gx)) + 0.5 * dpr;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      }
      for (let gyy = Math.max(0, Math.floor(bottom / 30) * 30); gyy <= top; gyy += 30) {
        ctx.strokeStyle = Math.round(gyy / 30) % 5 === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.07)";
        const py = Math.round(syOf(gyy)) + 0.5 * dpr;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(0, Math.round(gy), W, Math.max(1, dpr));            // ground line
    ctx.fillStyle = "rgba(80,220,120,.7)";
    ctx.fillRect(Math.round(sxOf(0)), 0, Math.max(1, dpr), H);       // level start (x = 0)

    // objects
    const order = this.getOrder();
    const showIds = this.opts.showIds && z >= 2.2 * dpr;
    const labels = [];
    for (let i = 0; i < order.length; i++) {
      const o = order[i], p = parseObj(o), s = assets.sprite(p.id);
      const reach = Math.max(s.w * p.sx, s.h * p.sy) * p.sc * 0.75;
      if (p.x + reach < left || p.x - reach > right || p.y + reach < bottom || p.y - reach > top) continue;
      const th = p.rot * D2R, c = Math.cos(th), sn = Math.sin(th);
      const kx = z * p.sx * p.sc * (p.fh ? -1 : 1), ky = z * p.sy * p.sc * (p.fv ? -1 : 1);
      ctx.setTransform(c * kx, sn * kx, -sn * ky, c * ky, sxOf(p.x), syOf(p.y));
      for (const layer of s.layers) {
        if (!layer.entry.ready) continue;
        const ch = layer.tint === "c1" ? col(p.c1 || 1004) : layer.tint === "c2" ? col(p.c2 || p.c1 || 1004) : null;
        ctx.globalAlpha = ch ? ch.a : 1;
        ctx.globalCompositeOperation = ch?.add ? "lighter" : "source-over";
        const src = ch && (ch.r !== 255 || ch.g !== 255 || ch.b !== 255) ? this.tinted(layer.entry, ch) : layer.entry.img;
        ctx.drawImage(src, -s.w / 2, -s.h / 2, s.w, s.h);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      if (showIds) labels.push(sxOf(p.x), syOf(p.y), p.id);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (labels.length) {
      ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.fillStyle = "#fff";
      for (let i = 0; i < labels.length; i += 3) {
        const t = String(labels[i + 2]);
        ctx.strokeText(t, labels[i], labels[i + 1]); ctx.fillText(t, labels[i], labels[i + 1]);
      }
    }

    // trigger links: selected triggers to every object in the group they target
    ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = "rgba(255,200,60,.8)"; ctx.setLineDash([6 * dpr, 4 * dpr]);
    for (const link of store.getLinks()) {
      const a = parseObj(link.from);
      for (const t of link.to) {
        const b = parseObj(t);
        ctx.beginPath(); ctx.moveTo(sxOf(a.x), syOf(a.y)); ctx.lineTo(sxOf(b.x), syOf(b.y)); ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // selection outlines
    ctx.strokeStyle = "#3da9ff";
    for (const o of store.selection) {
      const p = parseObj(o), s = assets.sprite(p.id);
      const th = p.rot * D2R, c = Math.cos(th), sn = Math.sin(th), kx = z * p.sx * p.sc, ky = z * p.sy * p.sc;
      ctx.setTransform(c * kx, sn * kx, -sn * ky, c * ky, sxOf(p.x), syOf(p.y));
      ctx.lineWidth = (2 * dpr) / Math.min(kx, ky);
      ctx.strokeRect(-s.w / 2, -s.h / 2, s.w, s.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // placement ghost
    if (this.ghost) {
      const g = this.ghost, s = assets.sprite(g.id);
      ctx.globalAlpha = 0.55;
      for (const layer of s.layers) {
        if (!layer.entry.ready) continue;
        ctx.drawImage(layer.entry.img, sxOf(g.x) - (s.w * z) / 2, syOf(g.y) - (s.h * z) / 2, s.w * z, s.h * z);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(61,169,255,.9)"; ctx.lineWidth = dpr;
      ctx.strokeRect(sxOf(g.x) - (s.w * z) / 2, syOf(g.y) - (s.h * z) / 2, s.w * z, s.h * z);
    }

    // selection box
    if (this.box) {
      const b = this.box, x = sxOf(Math.min(b.x0, b.x1)), y = syOf(Math.max(b.y0, b.y1));
      const w = Math.abs(b.x1 - b.x0) * z, h = Math.abs(b.y1 - b.y0) * z;
      ctx.fillStyle = "rgba(61,169,255,.15)"; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(61,169,255,.9)"; ctx.lineWidth = dpr; ctx.strokeRect(x, y, w, h);
    }
  }
}
