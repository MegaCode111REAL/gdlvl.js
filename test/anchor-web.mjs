// Browser test for placement anchoring, using the real texture atlas in data/spritesheets.
//   NODE_PATH=/opt/npm-tools/node_modules node test/anchor-web.mjs [screenshot-dir]
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { server } from "../scripts/serve.mjs";
import { Level } from "../src/gdlvl.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const shots = process.argv[2] ?? tmpdir(); mkdirSync(shots, { recursive: true });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 800 } })).newPage();
const problems = [];
page.on("pageerror", (e) => { problems.push("pageerror: " + e.message); console.log("pageerror:", e.message); });
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text()) && problems.push("console: " + m.text()));
const ed = (fn, arg) => page.evaluate(fn, arg);
const step = (n) => console.log("ok -", n);
await page.goto(`http://localhost:${server.address().port}/web/`);
await page.waitForFunction(() => window.__editor?.store?.level);
await page.waitForFunction(() => window.__editor.assets.originalTextures?.ready);
const nFrames = await ed(() => window.__editor.assets.originalTextures.count);
assert.ok(nFrames > 1000, `only ${nFrames} frames`); step(`atlas loads (${nFrames} frames)`);

// every texture we place below must be a real atlas sprite, not a placeholder
const kinds = await ed(() => [1, 8].map((id) => window.__editor.assets.sprite(id).kind));
assert.deepEqual(kinds, ["original", "original"]); step("block and spike use original textures");

// Pick test sprites: a 2-cell-wide frame and a short one, mapped onto spare object IDs.
const wide = await ed(async () => {
  const { visibleBounds } = await import("/web/app/anchor.js");
  const ot = window.__editor.assets.originalTextures;
  for (const [name] of ot.frames) {
    if (!/block\d+_slope_02_001\.png$/.test(name)) continue;
    ot.mapping.set(9001, name); ot.resolved.delete(9001);
    const v = visibleBounds(window.__editor.assets.sprite(9001));
    if (v && Math.round((v.r - v.l) / 30) === 2) return { name, v };
  }
  return null;
});
assert.ok(wide, "no two-cell slope frame in the atlas"); step(`two-cell sprite found: ${wide.name}`);

const world = (x, y) => ed(([x, y]) => { const b = document.getElementById("canvas").getBoundingClientRect(), p = window.__editor.renderer.toScreen(x, y); return { x: b.x + p.x, y: b.y + p.y }; }, [x, y]);
await ed(() => { const r = window.__editor.renderer; r.view.cx = 240; r.view.cy = 100; r.view.zoom = 2.5; r.requestDraw(); });
const arm = (id) => ed((id) => { const s = window.__editor.store; s.armed = id; s.emit("armed"); }, id);
const last = () => ed(() => { const s = window.__editor.store, o = s.level.objects.at(-1), a = window.__editor.assets; return { id: o.objectId, x: o.get("x"), y: o.get("y"), vis: null }; });
const cellCentre = (c, r) => ({ x: 15 + 30 * c, y: 15 + 30 * r });
async function placeAt(id, c, r) {
  await arm(id);
  const p = await world(cellCentre(c, r).x, cellCentre(c, r).y);
  await page.mouse.move(p.x + 3, p.y - 2);                       // hover: ghost follows
  const ghost = await ed(() => ({ ...window.__editor.renderer.ghost }));
  await page.mouse.click(p.x + 3, p.y - 2);
  const o = await last();
  assert.equal(o.x, ghost.x); assert.equal(o.y, ghost.y);          // ghost == final placement
  await ed(() => { const s = window.__editor.store; s.armed = null; s.emit("armed"); window.__editor.renderer.ghost = null; });
  return o;
}
const bounds = (id) => ed(async (id) => (await import("/web/app/anchor.js")).visibleBounds(window.__editor.assets.sprite(id)), id);

// 1. normal block
let o = await placeAt(1, 5, 2), v = await bounds(1);
assert.ok(Math.abs(o.y + v.b - (15 + 60 - 15)) < 0.01 && Math.abs(o.x + (v.l + v.r) / 2 - 165) < 0.01);
step(`block: visible bottom-centre on cell (origin ${o.x},${o.y})`);

// 2. spike (visible shape smaller than/different from the frame)
o = await placeAt(8, 7, 2); v = await bounds(8);
assert.ok(Math.abs(o.y + v.b - 60) < 0.01 && Math.abs(o.x + (v.l + v.r) / 2 - 225) < 0.01);
step(`spike: visible bottom-centre on cell (visible ${v.l.toFixed(1)}..${v.r.toFixed(1)} x ${v.b.toFixed(1)}..${v.t.toFixed(1)})`);

// 3. two-cell object: bottom-left of visible texture = bottom-left of the 2-cell footprint
o = await placeAt(9001, 9, 2); v = await bounds(9001);
assert.ok(Math.abs(o.x + v.l - (30 * 9)) < 0.01, `left ${o.x + v.l}`);
assert.ok(Math.abs(o.y + v.b - 60) < 0.01);
assert.ok(Math.abs((v.r - v.l) - 60) < 8);
step(`two-cell slope: visible bottom-left at footprint bottom-left (width ${(v.r - v.l).toFixed(1)})`);

// 3b. short texture (half-height block): bottom edge on the cell bottom, not centred in the cell
const slab = await ed(async () => {
  const { visibleBounds } = await import("/web/app/anchor.js"), ot = window.__editor.assets.originalTextures;
  for (const [name] of ot.frames) {
    if (!/^(?:block|square|plank)\w*_001\.png$/i.test(name) || /color|glow/.test(name)) continue;
    ot.mapping.set(9002, name); ot.resolved.delete(9002);
    const v = visibleBounds(window.__editor.assets.sprite(9002));
    if (v && v.t - v.b < 20 && v.r - v.l > 25 && v.r - v.l < 35) return name;
  }
  return null;
});
if (slab) { o = await placeAt(9002, 4, 2); v = await bounds(9002); assert.ok(Math.abs(o.y + v.b - 60) < 0.01 && Math.abs(o.x + (v.l + v.r) / 2 - 135) < 0.01); step(`short texture (${slab}): bottom edge on the cell bottom`); }
else console.log("skip - no half-height frame found by name");

// 4. orbs and portals keep the old placement: origin = cell centre
await ed(() => { const ot = window.__editor.assets.originalTextures; for (const [id, f] of [[36, "ring_01_001.png"], [10, "portal_01_back_001.png"]]) if (ot.frames.has(f)) { ot.mapping.set(id, f); ot.resolved.delete(id); } window.__editor.assets.cache.clear(); });
for (const id of [36, 10]) { o = await placeAt(id, id === 10 ? 12 : 11, 2); assert.deepEqual([o.x, o.y], [15 + 30 * (id === 10 ? 12 : 11), 75]); }
step("orb and portal: origin stays at the cell centre");

// 5. mouse picking and selection agree with the placed position
const at = await world(o.x, o.y);
await page.mouse.click(at.x, at.y);
assert.equal(await ed(() => { const s = [...window.__editor.store.selection][0]; return s?.objectId; }), 10);
step("clicking the rendered sprite selects the placed object");

// 6. rotate / flip / scale do not change stored placement
const before = await last();
await page.keyboard.press("r"); await page.keyboard.press("f");
const afterRot = await ed(() => { const o = [...window.__editor.store.selection][0]; return { x: o.get("x"), y: o.get("y") }; });
assert.deepEqual([afterRot.x, afterRot.y], [before.x, before.y]);
step("rotating and flipping leaves x/y alone");

// 7. textures actually paint (not an empty canvas) and the render loop survived the ghost
await ed(() => { const r = window.__editor.renderer; r.view.cx = 200; r.view.cy = 70; r.requestDraw(); });
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, "anchor-1-placed.png") });
const colours = await ed(() => { const c = document.getElementById("canvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, s = new Set(); for (let i = 0; i < d.length; i += 4 * 211) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return s.size; });
assert.ok(colours > 6); step("canvas renders textures");

// 8. export + reload keeps positions
const objs = await ed(() => window.__editor.store.level.objects.map((o) => [o.objectId, o.get("x"), o.get("y")]));
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
const path = join(shots, "anchor.gdlvl"); await dl.saveAs(path);
const re = Level.fromFileText(readFileSync(path, "utf8")).objects.map((o) => [o.objectId, o.get("x"), o.get("y")]);
assert.deepEqual(re, objs); step("save and reload keeps every position exactly");

await browser.close(); server.close();
assert.deepEqual(problems, [], problems.join("\n"));
console.log("all good");
