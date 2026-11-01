// Browser test for the keyboard shortcuts (DefKey's Geometry Dash editor list).
//   NODE_PATH=/opt/npm-tools/node_modules node test/shortcuts-web.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { server } from "../scripts/serve.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));
const ed = (fn, a) => page.evaluate(fn, a);
const step = (n) => console.log("ok -", n);
await page.goto(`http://localhost:${server.address().port}/web/`);
await page.waitForFunction(() => window.__editor?.store?.level);
await page.waitForFunction(() => window.__editor.assets.originalTextures?.ready);
await ed(() => { const r = window.__editor.renderer; r.view.cx = 240; r.view.cy = 100; r.view.zoom = 2.5; r.requestDraw(); });
const press = (k) => page.keyboard.press(k);
const sel = () => ed(() => [...window.__editor.store.selection].map((o) => ({ id: o.objectId, x: o.get("x"), y: o.get("y"), r: o.get("rotation") ?? 0, fh: !!o.get("flip_horiz"), fv: !!o.get("flip_vert") })));
const count = () => ed(() => window.__editor.store.level.objects.length);
const scr = (x, y) => ed(([x, y]) => { const b = document.getElementById("canvas").getBoundingClientRect(), p = window.__editor.renderer.toScreen(x, y); return { x: b.x + p.x, y: b.y + p.y }; }, [x, y]);
const pressed = (id) => page.getAttribute(id, "aria-pressed");
const add = (id, x, y) => ed(([id, x, y]) => { const s = window.__editor.store; return s.place(id, x, y) && 0; }, [id, x, y]);

await add(1, 165, 75);                                              // one selected block
let o = (await sel())[0];
await press("d"); assert.equal((await sel())[0].x, o.x + 30); await press("a"); await press("w"); await press("s");
assert.deepEqual([(await sel())[0].x, (await sel())[0].y], [o.x, o.y]); step("W A S D move the selection one grid step");
await press("Shift+d"); assert.equal((await sel())[0].x, o.x + 1); await press("Shift+a"); step("Shift+W/A/S/D move a small step");

await press("e"); assert.equal((await sel())[0].r, 90); await press("q"); assert.equal((await sel())[0].r, 0); await press("q"); assert.equal((await sel())[0].r, 270); await press("e");
step("E rotates 90 clockwise, Q 90 counter-clockwise");
await press("Alt+q"); assert.equal((await sel())[0].fh, true); await press("Alt+q");
await press("Alt+e"); assert.equal((await sel())[0].fv, true); await press("Alt+e"); step("Alt+Q flips X, Alt+E flips Y");

await press("Control+z"); await press("Control+Shift+z"); step("Ctrl+Z undo, Ctrl+Shift+Z redo");
await press("Control+c"); await press("Control+d"); assert.equal(await count(), 2); await press("Control+z"); step("Ctrl+C / Ctrl+D copy and duplicate");

await press("3"); assert.equal(await pressed("#mode-delete"), "true");
const at = await scr(165, 75); await page.mouse.click(at.x, at.y); assert.equal(await count(), 0); step("3 = Delete mode: clicking an object deletes it");
await press("Control+z");
await press("1"); assert.equal(await pressed("#mode-build"), "true"); await press("2"); assert.equal(await pressed("#mode-edit"), "true"); step("1 / 2 switch Build and Edit mode");

const before = await ed(() => document.getElementById("pal-class").selectedIndex);
await press("F2"); const after = await ed(() => document.getElementById("pal-class").selectedIndex);
await press("F1"); assert.equal(after, before + 1); assert.equal(await ed(() => document.getElementById("pal-class").selectedIndex), before); step("F1 / F2 previous and next build tab");

await ed(() => { const s = window.__editor.store; s.place(1, 195, 75); s.level.objects.at(-1).set("groups", [7]); s.place(1, 225, 75); s.level.objects.at(-1).set("groups", [9]); s.clearSelection(); });
await press("ArrowRight"); assert.equal((await sel()).length, 1); const g1 = await ed(() => [...window.__editor.store.selection][0].groupList[0]);
await press("ArrowRight"); const g2 = await ed(() => [...window.__editor.store.selection][0].groupList[0]);
await press("ArrowLeft"); assert.ok(g1 === 7 && g2 === 9 && (await ed(() => [...window.__editor.store.selection][0].groupList[0])) === 7); step("Left / Right arrows select the previous / next group");

await press("g"); assert.equal(await ed(() => window.__editor.store.snap), 0); assert.equal(await pressed("#tog-snap"), "false"); await press("g"); assert.equal(await ed(() => window.__editor.store.snap), 30); step("G toggles snap");
for (const [k, id] of [["r", "#tog-rotate"], ["t", "#tog-swipe"], ["f", "#tog-free"]]) { await press(k); assert.equal(await pressed(id), "true"); await press(k); assert.equal(await pressed(id), "false"); }
step("R / T / F toggle Rotate, Swipe and Free move");

// Swipe: drag across two blocks selects both
await ed(() => window.__editor.store.clearSelection()); await press("t");
const a = await scr(195, 75), b = await scr(225, 75);
await page.mouse.move(a.x - 20, a.y); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y, { steps: 8 }); await page.mouse.up();
assert.equal((await sel()).length, 2); await press("t"); step("Swipe selects every object the drag passes over");

// Rotate: drag round the selection's centre turns it
await press("r"); const c = await scr(210, 75);
await page.mouse.move(c.x + 60, c.y); await page.mouse.down(); await page.mouse.move(c.x, c.y + 60, { steps: 10 }); await page.mouse.up();
const rot = (await sel()).map((s) => s.r); assert.ok(rot.every((r) => r === 90), JSON.stringify(rot)); await press("r"); step("Rotate toggle: dragging turns the selection (15-degree steps)");

// Free move: drag without snapping
await press("f"); const d0 = await scr(210, 75); const x0 = (await sel())[0].x;
await page.mouse.move(d0.x, d0.y); await page.mouse.down(); await page.mouse.move(d0.x + 7, d0.y, { steps: 4 }); await page.mouse.up();
assert.notEqual(((await sel())[0].x - x0) % 30, 0); await press("f"); step("Free move drags without snapping");

// View: wheel scrolls up/down, +/- zoom
const v0 = await ed(() => ({ ...window.__editor.renderer.view }));
await page.mouse.move(600, 400); await page.mouse.wheel(0, 100);
const v1 = await ed(() => ({ ...window.__editor.renderer.view })); assert.ok(v1.cy < v0.cy && v1.zoom === v0.zoom); step("mouse wheel moves the view up and down");
await press("="); assert.ok((await ed(() => window.__editor.renderer.view.zoom)) > v0.zoom); await press("-"); await press("-"); assert.ok((await ed(() => window.__editor.renderer.view.zoom)) < v0.zoom); step("+ and - zoom");

await press("Enter"); await press("Control+Enter"); step("Enter / Ctrl+Enter answer with a clear message (no playtest in the editor)");
await browser.close(); server.close();
assert.deepEqual(problems, [], problems.join("\n")); console.log("all good");
