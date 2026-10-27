// Editor state and every operation that changes the level. The UI never edits the level directly:
// it calls these, which keep selection, undo history and autosave consistent.
import { Level, GDObject, fieldsOf } from "../../src/gdlvl.js";
import { parseObj } from "./render.js?v=ghost-outline-fix-2";
import { kvGet, kvSet } from "./idb.js";

const HISTORY_LIMIT = 100;

export class Store {
  constructor() {
    this.level = null;
    this.selection = new Set();
    this.armed = null;       // object ID chosen in the palette for placing, or null
    this.snap = 30;          // grid step in units; 0 = off
    this.rev = 0;            // bumps on any change
    this.orderRev = 0;       // bumps when draw order may have changed (add, remove, undo, load)
    this.clipboard = [];     // strings of copied objects
    this.history = []; this.hi = -1;
    this.listeners = new Set();
    this.linksCache = { rev: -1, sel: -1, links: [] };
    this.selRev = 0;
    this.drag = null;
    this.saveTimer = null;
    this.onSaved = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type) { this.rev++; for (const fn of this.listeners) fn(type); }

  // ---- loading and saving -----------------------------------------------------------------
  load(text) {
    const level = Level.fromFileText(text); // throws on bad files; nothing changes in that case
    this.level = level;
    this.selection = new Set(); this.selRev++;
    this.history = []; this.hi = -1;
    this.orderRev++;
    this.pushHistory();
    this.emit("load");
  }

  toText() { return this.level.toFileText(); }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { kvSet("autosave", { text: this.toText(), savedAt: Date.now() }).then(() => this.onSaved?.()); } catch { /* storage unavailable */ }
    }, 800);
  }

  async restoreAutosave() {
    const saved = await kvGet("autosave");
    if (!saved?.text) return false;
    try { this.load(saved.text); return saved; } catch { return false; }
  }

  // ---- history ------------------------------------------------------------------------------
  snapshot() {
    const idx = new Map(this.level.objects.map((o, i) => [o, i]));
    return {
      objs: this.level.objects.map(String),
      header: this.level.headerTokens.slice(),
      sel: [...this.selection].map((o) => idx.get(o)).filter((i) => i !== undefined),
    };
  }
  pushHistory() {
    this.history.length = this.hi + 1;
    this.history.push(this.snapshot());
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.hi = this.history.length - 1;
  }
  restore(s) {
    // Keep the current selection (by position) when nothing was added or removed, so undoing a move
    // or property edit leaves the same objects selected. Otherwise use the selection saved with the state.
    const sameCount = this.level.objects.length === s.objs.length;
    const idx = new Map(this.level.objects.map((o, i) => [o, i]));
    const keep = sameCount ? [...this.selection].map((o) => idx.get(o)).filter((i) => i !== undefined) : s.sel;
    this.level.objects = s.objs.map(GDObject.parse);
    this.level.headerTokens = s.header.slice();
    this.selection = new Set(keep.map((i) => this.level.objects[i]).filter(Boolean)); this.selRev++;
    this.orderRev++;
  }
  /** Record the current state as an undo step. Call after a finished edit. */
  commit(kind = "edit") {
    this.pushHistory();
    this.scheduleSave();
    this.emit(kind);
  }
  undo() { if (this.hi > 0) { this.restore(this.history[--this.hi]); this.scheduleSave(); this.emit("history"); } }
  redo() { if (this.hi < this.history.length - 1) { this.restore(this.history[++this.hi]); this.scheduleSave(); this.emit("history"); } }
  get canUndo() { return this.hi > 0; }
  get canRedo() { return this.hi < this.history.length - 1; }

  // ---- selection ----------------------------------------------------------------------------
  select(objs, additive = false) {
    if (!additive) this.selection = new Set();
    for (const o of objs) this.selection.add(o);
    this.selRev++; this.emit("selection");
  }
  toggle(o) { this.selection.has(o) ? this.selection.delete(o) : this.selection.add(o); this.selRev++; this.emit("selection"); }
  clearSelection() { if (this.selection.size) { this.selection = new Set(); this.selRev++; this.emit("selection"); } }
  selectAll() { this.select(this.level.objects); }
  selectByGroup(g) { this.select(this.level.objects.filter((o) => o.groupList.includes(g))); }
  selectById(id) { this.select(this.level.objects.filter((o) => o.objectId === id)); }

  /** Links from selected triggers to the objects in the group they target. */
  getLinks() {
    const c = this.linksCache;
    if (c.rev === this.rev && c.sel === this.selRev) return c.links;
    const links = [];
    if (this.selection.size && this.selection.size <= 30) {
      const wanted = new Map();
      for (const o of this.selection) {
        if (!fieldsOf(o.className).byName.has("target_group")) continue;
        const g = o.get("target_group");
        if (g) wanted.set(o, g);
      }
      if (wanted.size) {
        const byGroup = new Map();
        for (const o of this.level.objects) for (const g of o.groupList) (byGroup.get(g) ?? byGroup.set(g, []).get(g)).push(o);
        for (const [from, g] of wanted) links.push({ from, to: (byGroup.get(g) ?? []).filter((t) => t !== from) });
      }
    }
    this.linksCache = { rev: this.rev, sel: this.selRev, links };
    return links;
  }

  // ---- editing ------------------------------------------------------------------------------
  place(id, x, y) {
    const o = this.level.add(id, x, y);
    if (!/Trigger$/.test(o.className) && o.className !== "Trigger") o.set("color_1_index", 1); // the game's own objects carry this
    this.selection = new Set([o]); this.selRev++;
    this.orderRev++;
    this.commit("place");
    return o;
  }

  deleteSelected() {
    if (!this.selection.size) return;
    this.level.objects = this.level.objects.filter((o) => !this.selection.has(o));
    this.selection = new Set(); this.selRev++;
    this.orderRev++;
    this.commit("delete");
  }

  /** Move the selection by a distance. Used for arrow keys; dragging uses beginDrag/dragTo/endDrag. */
  moveSelected(dx, dy) {
    if (!this.selection.size) return;
    for (const o of this.selection) { o.set("x", +(o.get("x") + dx).toFixed(4)); o.set("y", +(o.get("y") + dy).toFixed(4)); }
    this.commit("move");
  }

  beginDrag() {
    this.drag = { orig: [...this.selection].map((o) => [o, o.get("x") ?? 0, o.get("y") ?? 0]), moved: false };
  }
  dragTo(dx, dy) {
    if (!this.drag) return;
    this.drag.moved = this.drag.moved || dx !== 0 || dy !== 0;
    for (const [o, x, y] of this.drag.orig) { o.set("x", +(x + dx).toFixed(4)); o.set("y", +(y + dy).toFixed(4)); }
    this.rev++; for (const fn of this.listeners) fn("drag");
  }
  endDrag() {
    const moved = this.drag?.moved;
    this.drag = null;
    if (moved) this.commit("move");
  }

  center(objs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of objs) { const p = parseObj(o); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }

  /** Rotate the selection by 90 degree steps (positive = clockwise); several objects turn around their middle. */
  rotateSelected(steps) {
    const objs = [...this.selection];
    if (!objs.length) return;
    const c = this.center(objs);
    for (const o of objs) {
      o.set("rotation", ((((o.get("rotation") ?? 0) + 90 * steps) % 360) + 360) % 360);
      if (objs.length > 1) {
        const dx = o.get("x") - c.x, dy = o.get("y") - c.y;
        const k = ((steps % 4) + 4) % 4;
        const [nx, ny] = [[dx, dy], [dy, -dx], [-dx, -dy], [-dy, dx]][k];
        o.set("x", +(c.x + nx).toFixed(4)); o.set("y", +(c.y + ny).toFixed(4));
      }
    }
    this.commit("rotate");
  }

  /** Flip the selection horizontally (axis "x") or vertically ("y"); several objects mirror around their middle. */
  flipSelected(axis) {
    const objs = [...this.selection];
    if (!objs.length) return;
    const c = this.center(objs), prop = axis === "x" ? "flip_horiz" : "flip_vert", pos = axis === "x" ? "x" : "y";
    for (const o of objs) {
      o.set(prop, !o.get(prop));
      if (objs.length > 1) o.set(pos, +(2 * c[pos] - o.get(pos)).toFixed(4));
    }
    this.commit("flip");
  }

  copy() { this.clipboard = [...this.selection].map(String); }

  /** Paste copies with their middle at (x, y); the new objects become the selection. */
  paste(x, y) {
    if (!this.clipboard.length) return;
    const objs = this.clipboard.map(GDObject.parse);
    const c = this.center(objs), dx = x - c.x, dy = y - c.y;
    for (const o of objs) { o.set("x", +(o.get("x") + dx).toFixed(4)); o.set("y", +(o.get("y") + dy).toFixed(4)); }
    this.level.objects.push(...objs);
    this.selection = new Set(objs); this.selRev++;
    this.orderRev++;
    this.commit("paste");
  }

  duplicate() {
    if (!this.selection.size) return;
    const objs = [...this.selection].map((o) => GDObject.parse(String(o)));
    for (const o of objs) o.set("x", o.get("x") + 30);
    this.level.objects.push(...objs);
    this.selection = new Set(objs); this.selRev++;
    this.orderRev++;
    this.commit("duplicate");
  }

  /** Set a property (schema name) on objects whose class has it. Returns how many changed. */
  setProp(objs, name, value) {
    let n = 0;
    for (const o of objs) {
      if (!fieldsOf(o.className).byName.has(name)) continue;
      const f = fieldsOf(o.className).byName.get(name);
      if (Array.isArray(value) && !value.length) o.delete(name); else o.set(name, value);
      void f; n++;
    }
    if (name === "z_layer" || name === "z_order") this.orderRev++;
    this.commit("prop");
    return n;
  }

  removeProp(objs, name) {
    for (const o of objs) o.delete(name);
    if (name === "z_layer" || name === "z_order") this.orderRev++;
    this.commit("prop");
  }

  setChannelColor(id, r, g, b, final = true) {
    this.level.setColor(id, r, g, b);
    if (final) this.commit("color"); else this.emit("color-live");
  }

  rename(name) { this.level.name = name; this.scheduleSave(); this.emit("name"); }
}
