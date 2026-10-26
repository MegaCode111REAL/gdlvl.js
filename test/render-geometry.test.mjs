import test from "node:test";
import assert from "node:assert/strict";
import { Renderer } from "../web/app/render.js";

function hitTest({ rotation = 0, x = 0, y = 0, sx = 1, sy = 1, scale = 1 } = {}, point) {
  const object = {
    entries: [
      ["1", "1"], ["2", String(x)], ["3", String(y)],
      ["6", String(rotation)], ["32", String(scale)],
      ["128", String(sx)], ["129", String(sy)]
    ]
  };
  const renderer = Object.create(Renderer.prototype);
  renderer.getOrder = () => [object];
  renderer.assets = { sprite: () => ({ w: 100, h: 40 }) };
  return renderer.pick(point.x, point.y) === object;
}

test("rotated non-square sprite hit testing follows the drawn transform at 45 degrees", () => {
  const angle = Math.PI / 4;
  // Local point (45, 0) transformed into world coordinates; canvas rotation makes world Y negative.
  const point = { x: 45 * Math.cos(angle), y: -45 * Math.sin(angle) };
  assert.equal(hitTest({ rotation: 45 }, point), true);
});

test("portal-like tall sprite remains clickable after a 90-degree rotation", () => {
  // Local point (0, 15) rotates to world point (-15, 0).
  assert.equal(hitTest({ rotation: 90 }, { x: -15, y: 0 }), true);
});

test("rotated hit testing rejects points outside the actual sprite bounds", () => {
  const angle = Math.PI / 4;
  // Local point (60, 0) is beyond the 50-unit half-width.
  const point = { x: 60 * Math.cos(angle), y: -60 * Math.sin(angle) };
  assert.equal(hitTest({ rotation: 45 }, point), false);
});

test("rotated hit testing respects non-uniform object scale", () => {
  // With sx=2, the 50-unit half-width becomes 100 world units before rotation.
  const angle = Math.PI / 4;
  const point = { x: 80 * Math.cos(angle), y: -80 * Math.sin(angle) };
  assert.equal(hitTest({ rotation: 45, sx: 2 }, point), true);
});
