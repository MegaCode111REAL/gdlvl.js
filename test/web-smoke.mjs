// Headless-browser smoke test for the editor. Not part of `npm test` because it needs Playwright:
//   npm install --no-save playwright && node test/web-smoke.mjs        (or set NODE_PATH to an install)
// Screenshots go to the folder given as the first argument (default: the OS temp dir).
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { server } from "../scripts/serve.mjs";
import { Level } from "../src/gdlvl.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const shots = process.argv[2] ?? tmpdir();
mkdirSync(shots, { recursive: true });
const root = new URL("../", import.meta.url).pathname;

await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/web/`;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 800 } })).newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
page.on("requestfailed", (r) => problems.push("request failed: " + r.url()));

const ed = (fn, arg) => page.evaluate(fn, arg);
const count = () => ed(() => window.__editor.store.level.objects.length);
const canvasBox = () => page.locator("#canvas").boundingBox();
const screenOf = async (x, y) => { const b = await canvasBox(); const p = await ed(([x, y]) => window.__editor.renderer.toScreen(x, y), [x, y]); return { x: b.x + p.x, y: b.y + p.y }; };
const step = (name) => console.log("ok -", name);

await page.goto(url);
await page.waitForFunction(() => window.__editor?.store?.level);
assert.equal(await count(), 0); step("page loads and starts with a blank level");

// open a level through the file input
await page.setInputFiles("#file-open", join(root, "examples/neon-drift.gdlvl"));
await page.waitForFunction(() => window.__editor.store.level.objects.length === 378);
assert.equal(await ed(() => window.__editor.store.level.name), "Neon Drift"); step("opens neon-drift.gdlvl (378 objects)");

// the canvas actually shows something
await page.waitForTimeout(400);
const painted = await ed(() => {
  const c = document.getElementById("canvas"), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 997) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return seen.size;
});
assert.ok(painted > 8, `canvas looks empty (${painted} colours)`); step("canvas renders the level");
await page.screenshot({ path: join(shots, "editor-1-opened.png") });

// click a spike to select it, then nudge and undo
const spike = await ed(() => { const o = window.__editor.store.level.objects.find((o) => o.objectId === 8); return { x: o.get("x"), y: o.get("y") }; });
await ed(([x, y]) => { const r = window.__editor.renderer; r.view.cx = x; r.view.cy = y + 20; r.view.zoom = 4; r.requestDraw(); }, [spike.x, spike.y]);
const at = await screenOf(spike.x, spike.y);
await page.mouse.click(at.x, at.y);
assert.equal(await ed(() => window.__editor.store.selection.size), 1); step("clicking an object selects it");
assert.match(await page.locator("#props .sel-title").innerText(), /Spike/);

await page.keyboard.press("ArrowRight");
assert.equal(await ed(() => [...window.__editor.store.selection][0].get("x")), spike.x + 30); step("arrow key moves by one grid step");
await page.keyboard.press("Control+z");
assert.equal(await ed(() => [...window.__editor.store.selection][0]?.get("x")), spike.x); step("undo puts it back");
await page.keyboard.press("Control+y");
await page.keyboard.press("Control+z");

// drag with the mouse: should snap to the 30-unit grid
const dragFrom = await screenOf(spike.x, spike.y);
await page.mouse.move(dragFrom.x, dragFrom.y); await page.mouse.down();
await page.mouse.move(dragFrom.x + 4 * 30 * 4 + 7, dragFrom.y - 2, { steps: 6 }); await page.mouse.up();
const dragged = await ed(() => { const o = [...window.__editor.store.selection][0]; return { x: o.get("x"), y: o.get("y") }; });
assert.equal(dragged.x, spike.x + 120); assert.equal(dragged.y, spike.y); step("mouse drag moves and snaps to the grid");
await page.keyboard.press("Control+z");

// edit a property in the panel
await page.fill("#p-rotation", "90"); await page.locator("#p-rotation").blur();
assert.equal(await ed(() => [...window.__editor.store.selection][0].get("rotation")), 90); step("property panel edits rotation");
await page.keyboard.press("Control+z");

// place an object from the palette
await page.fill("#pal-q", "move trigger");
await page.locator("#pal-list li").first().click();
const before = await count();
const target = await screenOf(spike.x + 90, spike.y + 90);
await page.mouse.click(target.x, target.y);
assert.equal(await count(), before + 1);
const placed = await ed(() => [...window.__editor.store.selection][0].toString());
assert.match(placed, /^1,901,2,\d+,3,\d+/); step("placing a Move trigger from the palette");
await page.keyboard.press("Escape");

// trigger properties come from the schema
await page.fill("#p-move_x", "120"); await page.locator("#p-move_x").blur().catch(() => {});
const trig = await ed(() => [...window.__editor.store.selection][0]);
assert.ok(trig, "trigger still selected");
assert.equal(await ed(() => [...window.__editor.store.selection][0].get("move_x")), 120); step("trigger properties come from the schema (move_x = 120)");
await page.screenshot({ path: join(shots, "editor-2-trigger.png") });

// colours
await ed(() => { const s = window.__editor.store; s.setChannelColor(1000, 10, 60, 40, true); });
assert.equal(await ed(() => window.__editor.store.level.colors.some((c) => c.some(([k, v]) => k === "6" && v === "1000") && c.some(([k, v]) => k === "2" && v === "60"))), true);
step("background colour channel can be changed");

// delete + select all + copy/paste
await page.keyboard.press("Control+a");
assert.equal(await ed(() => window.__editor.store.selection.size), await count());
await page.keyboard.press("Escape");

// export, then read the downloaded file with the Node library
const [download] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
const path = join(shots, "exported.gdlvl");
await download.saveAs(path);
const exported = Level.fromFileText(readFileSync(path, "utf8"));
assert.equal(exported.objects.length, await count());
assert.equal(exported.field("k48"), String(exported.objects.length));
assert.deepEqual(exported.validate(), []);
step(`export writes a file the Node library reads back (${exported.objects.length} objects, name "${exported.name}")`);

// autosave survives a reload
await page.waitForTimeout(1200);
await page.reload();
await page.waitForFunction(() => window.__editor?.store?.level);
assert.equal(await count(), exported.objects.length); step("autosave restores the level after a reload");

// custom art: loading a file named by object ID replaces the placeholder
await page.setInputFiles("#file-tex", [{ name: "8.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#f0f"/></svg>') }]);
await page.waitForFunction(() => window.__editor.assets.sprite(8).custom === true);
assert.equal(await ed(() => window.__editor.assets.sprite(8).w), 60); step("custom art overrides the placeholder (240 px = 60 units)");
await page.click("#tex-menu summary"); await page.click("#btn-tex-clear");
await page.waitForFunction(() => window.__editor.assets.sprite(8).custom === false); step("clearing loaded art restores placeholders");

await page.screenshot({ path: join(shots, "editor-3-final.png") });
await browser.close(); server.close();
assert.deepEqual(problems, [], "browser reported errors:\n" + problems.join("\n"));
console.log("all good; screenshots in", shots);
