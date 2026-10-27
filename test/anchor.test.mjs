import test from "node:test";
import assert from "node:assert/strict";
import { anchorOrigin } from "../web/app/anchor.js";

const cell = { x: 15 + 30 * 4, y: 15 + 30 * 2 };           // column 4, row 2
test("full-cell texture keeps its origin at the cell centre", () => {
  assert.deepEqual(anchorOrigin({ l: -15, r: 15, b: -15, t: 15 }, cell), cell);
});
test("short texture: bottom edge sits on the cell's bottom edge, centred horizontally", () => {
  const o = anchorOrigin({ l: -15, r: 15, b: -4, t: 4 }, cell);     // 8-high pad-like sprite
  assert.equal(o.y + -4, cell.y - 15); assert.equal(o.x, cell.x);
});
test("off-centre transparent padding does not shift the visible texture", () => {
  const o = anchorOrigin({ l: -10, r: 14, b: -15, t: 12 }, cell);   // visible area is not centred in its frame
  assert.equal(o.x + (-10 + 14) / 2, cell.x);
  assert.equal(o.y - 15, cell.y - 15);
});
test("two-cell texture: visible bottom-left meets the footprint's bottom-left", () => {
  const o = anchorOrigin({ l: -30, r: 30, b: -15, t: 15 }, cell);
  assert.equal(o.x - 30, cell.x - 15); assert.equal(o.y - 15, cell.y - 15);
  const o2 = anchorOrigin({ l: -28, r: 31, b: -12, t: 15 }, cell);  // padded 2-cell sprite
  assert.equal(o2.x - 28, cell.x - 15); assert.equal(o2.y - 12, cell.y - 15);
});
