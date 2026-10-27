// Wires the store, renderer, panels and input together.
import { Store } from "./store.js";
import { Assets } from "./assets.js";
import { Renderer } from "./render.js";
import { initPalette, initProps, initColors, initInfo } from "./ui.js";
import { objectName } from "../../src/gdlvl.js";
import { installOriginalTextures } from "./original-textures.js";
import { placementPos } from "./anchor.js";

const $ = (id) => document.getElementById(id);

let toastTimer;
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg; t.className = "show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), isError ? 6000 : 2500);
}

async function main() {
  const store = new Store();
  const assets = new Assets("../assets/");
  try { await assets.load(); } catch (e) { toast(e.message, true); }
  const originalTextures = await installOriginalTextures(assets);

  const loadBlank = async () => store.load(await (await fetch(new URL("../assets/blank.gdlvl", import.meta.url))).text());
  const saved = await store.restoreAutosave();
  if (!saved) await loadBlank();

  const canvas = $("canvas");
  const renderer = new Renderer(canvas, store, assets);
  window.__editor = { store, renderer, assets }; // handy in the console, and for tests

  initPalette({ store, assets });
  initProps({ store });
  initColors({ store });
  initInfo({ store });

  const redraw = () => renderer.requestDraw();
  window.addEventListener("resize", () => renderer.resize());
  new ResizeObserver(() => renderer.resize()).observe(canvas);
  renderer.resize();
  renderer.home();
  if (saved) toast("Restored your last session");

  // ---- toolbar -------------------------------------------------------------------------
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || String(e), true); } };
  const openText = guard((text, name) => { store.load(text); renderer.home(); toast(`Opened ${name ?? "level"}: ${store.level.objects.length} objects`); });

  $("btn-new").onclick = guard(async () => { if (!store.level.objects.length || confirm("Start a new level? Unsaved changes are kept only in autosave.")) { await loadBlank(); renderer.home(); } });
  $("btn-open").onclick = () => $("file-open").click();
  $("file-open").onchange = async (e) => { const f = e.target.files[0]; if (f) openText(await f.text(), f.name); e.target.value = ""; };
  $("btn-export").onclick = guard(() => {
    const issues = store.level.validate();
    if (issues.length && !confirm(`${issues.length} object(s) have properties this editor doesn't know. They are kept as they are. Export anyway?`)) return;
    const name = (store.level.name || "level").replace(/[^\w.-]+/g, "_");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([store.toText()], { type: "application/octet-stream" })), download: `${name}.gdlvl` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${name}.gdlvl`);
  });
  $("btn-undo").onclick = () => store.undo();
  $("btn-redo").onclick = () => store.redo();
  $("btn-fit").onclick = () => renderer.fit();
  $("snap").onchange = (e) => (store.snap = Number(e.target.value));
  $("opt-ids").onchange = (e) => { renderer.opts.showIds = e.target.checked; redraw(); };
  $("opt-grid").onchange = (e) => { renderer.opts.grid = e.target.checked; redraw(); };

  const texInfo = () => {
    const status = originalTextures.ready
      ? `${originalTextures.count} original frames loaded · ${originalTextures.mapping.size} exact object mappings`
      : `Original textures FAILED to load: ${originalTextures.error || "no atlas frames found"}`;
    $("tex-info").textContent = `${status} · ${Object.keys(assets.manifest.objects).length} custom repo images · ${assets.packCount} loaded files`;
    $("btn-original-textures").textContent = originalTextures.enabled ? "Disable original textures" : "Enable original textures";
  };
  $("btn-original-textures").onclick = () => { originalTextures.setEnabled(!originalTextures.enabled); assets.originalTexturesChanged(); texInfo(); toast(originalTextures.enabled ? "Original textures enabled" : "Original textures disabled"); };
  const frameSelect = $("original-frame-select");
  const renderFrameOptions = () => {
    const names = originalTextures.frameNames($("original-frame-search").value);
    frameSelect.replaceChildren(...(names.length ? names.map((name) => Object.assign(document.createElement("option"), { value: name, textContent: name })) : [Object.assign(document.createElement("option"), { value: "", textContent: "No matches — type part of a frame name" })]));
  };
  $("original-frame-search").addEventListener("input", renderFrameOptions);
  $("btn-assign-original-frame").onclick = guard(async () => {
    await originalTextures.setMapping($("original-object-id").value, frameSelect.value);
    assets.originalTexturesChanged(); texInfo();
    toast(`Mapped object #${$("original-object-id").value} to ${frameSelect.value}`);
  });
  $("btn-clear-original-frame").onclick = guard(async () => {
    const id = $("original-object-id").value;
    if (!id) throw new Error("Enter an object ID first.");
    await originalTextures.clearMapping(id);
    assets.originalTexturesChanged(); texInfo();
    toast(`Cleared custom mapping for object #${id}`);
  });
  $("btn-tex-load").onclick = () => $("file-tex").click();
  $("file-tex").onchange = guard(async (e) => {
    const n = await assets.loadPackFiles(e.target.files); e.target.value = "";
    texInfo(); toast(n ? `Loaded ${n} texture file(s)` : "No files matched. Name them like 8.png, 8_detail.png", !n);
  });
  $("btn-tex-clear").onclick = guard(async () => { await assets.clearPack(); texInfo(); toast("Cleared loaded textures"); });
  $("tex-menu").addEventListener("toggle", texInfo);
  texInfo();

  // ---- status, undo buttons, save time --------------------------------------------------
  const updateUi = () => {
    $("btn-undo").disabled = !store.canUndo; $("btn-redo").disabled = !store.canRedo;
    $("st-sel").textContent = store.selection.size ? `${store.selection.size} selected` : "";
    $("st-zoom").textContent = `zoom ${Math.round(renderer.view.zoom * 50)}%`;
    $("snap").value = String(store.snap);
    const id = store.armed;
    $("hint").textContent = id != null ? `Placing ${objectName(id) ?? "#" + id}: click to place, Esc to stop` : "";
  };
  store.on((t) => { updateUi(); redraw(); if (t === "armed" && store.armed == null) { renderer.ghost = null; } });
  store.onSaved = () => { $("st-save").textContent = `Autosaved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; };
  renderer.onView = updateUi;
  updateUi();

  // ---- canvas input -----------------------------------------------------------------------
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const snapPoint = (w, e) => {
    const s = e?.altKey ? 0 : store.snap;
    return s ? { x: Math.round((w.x - 15) / s) * s + 15, y: Math.round((w.y - 15) / s) * s + 15 } : { x: +w.x.toFixed(2), y: +w.y.toFixed(2) };
  };
  const snapDelta = (d, e) => { const s = e?.altKey ? 0 : store.snap; return s ? Math.round(d / s) * s : +d.toFixed(2); };

  let mode = null, start = null, last = null, additive = false, spaceDown = false, cursor = { x: 0, y: 0 };

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId); canvas.focus?.();
    const p = local(e), w = renderer.toWorld(p.x, p.y);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) { mode = "pan"; last = p; e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (store.armed != null) { const s = placementPos(assets, store.armed, snapPoint(w, e)); store.place(store.armed, s.x, s.y); return; }
    const hit = renderer.pick(w.x, w.y);
    if (hit) {
      if (e.shiftKey) { store.toggle(hit); return; }
      if (!store.selection.has(hit)) store.select([hit]);
      store.beginDrag(); mode = "move"; start = w;
    } else {
      mode = "box"; start = w; additive = e.shiftKey; last = p;
      renderer.box = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = local(e), w = renderer.toWorld(p.x, p.y);
    cursor = w;
    $("st-cursor").textContent = `x ${w.x.toFixed(1)}  y ${w.y.toFixed(1)}`;
    if (store.armed != null && !mode) { const s = placementPos(assets, store.armed, snapPoint(w, e)); renderer.ghost = { id: store.armed, x: s.x, y: s.y }; redraw(); }
    if (mode === "pan") { renderer.pan(p.x - last.x, p.y - last.y); last = p; }
    else if (mode === "move") store.dragTo(snapDelta(w.x - start.x, e), snapDelta(w.y - start.y, e));
    else if (mode === "box") { renderer.box.x1 = w.x; renderer.box.y1 = w.y; redraw(); }
  });
  const finish = (e) => {
    if (mode === "move") store.endDrag();
    else if (mode === "box") {
      const b = renderer.box, p = local(e), tiny = Math.hypot(p.x - last.x, p.y - last.y) < 4;
      renderer.box = null;
      if (tiny) { if (!additive) store.clearSelection(); }
      else store.select(renderer.inRect(b.x0, b.y0, b.x1, b.y1), additive);
      redraw();
    }
    mode = null;
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", () => { if (!mode && renderer.ghost) { renderer.ghost = null; redraw(); } });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e);
    renderer.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  // ---- keyboard ---------------------------------------------------------------------------
  const SNAPS = [30, 15, 7.5, 3.75, 1, 0];
  window.addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) {
      if (e.key === "Escape") t.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.code === "Space") { spaceDown = true; e.preventDefault(); return; }
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
    else if (mod && k === "y") { e.preventDefault(); store.redo(); }
    else if (mod && k === "a") { e.preventDefault(); store.selectAll(); }
    else if (mod && k === "c") { e.preventDefault(); store.copy(); toast(`Copied ${store.clipboard.length} object(s)`); }
    else if (mod && k === "v") { e.preventDefault(); const s = snapPoint(cursor); store.paste(s.x, s.y); }
    else if (mod && k === "d") { e.preventDefault(); store.duplicate(); }
    else if (mod) return;
    else if (k === "delete" || k === "backspace") { e.preventDefault(); store.deleteSelected(); }
    else if (k.startsWith("arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : store.snap || 1;
      store.moveSelected(k === "arrowleft" ? -step : k === "arrowright" ? step : 0, k === "arrowdown" ? -step : k === "arrowup" ? step : 0);
    }
    else if (k === "r") store.rotateSelected(e.shiftKey ? -1 : 1);
    else if (k === "f") store.flipSelected(e.shiftKey ? "y" : "x");
    else if (k === "g") { store.snap = SNAPS[(SNAPS.indexOf(store.snap) + 1) % SNAPS.length]; updateUi(); toast(store.snap ? `Grid ${store.snap}` : "Grid off"); }
    else if (k === "home") renderer.fit();
    else if (k === "escape") { if (store.armed != null) { store.armed = null; renderer.ghost = null; store.emit("armed"); } else store.clearSelection(); }
  });

  // ---- drag and drop ----------------------------------------------------------------------
  let depth = 0;
  const show = (on) => $("drop").classList.toggle("show", on);
  window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; show(true); });
  window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; show(false); } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", guard(async (e) => {
    e.preventDefault(); depth = 0; show(false);
    const files = [...e.dataTransfer.files];
    const lvl = files.find((f) => /\.(gdlvl|txt)$/i.test(f.name));
    if (lvl) return openText(await lvl.text(), lvl.name);
    const n = await assets.loadPackFiles(files);
    texInfo(); toast(n ? `Loaded ${n} texture file(s)` : "Drop a .gdlvl file, or image files named like 8.png", !n);
  }));

  window.addEventListener("error", (e) => toast(e.message, true));
  window.addEventListener("unhandledrejection", (e) => toast(String(e.reason?.message ?? e.reason), true));
}

main().catch((e) => { console.error(e); toast(e.message || String(e), true); });
