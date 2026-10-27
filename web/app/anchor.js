// Placement anchoring. Given where the user clicked (a snapped grid-cell centre), work out where the
// object's origin must be stored so the *visible* texture sits on the grid:
//   - one-cell-wide objects: bottom-centre of the visible texture = bottom-centre of the cell
//   - objects two or more cells wide (long slopes ...): bottom-left of the visible texture =
//     bottom-left of the footprint, which starts at the clicked cell and extends to the right
// Portals and orbs keep their old placement (origin = cell centre).
// This module only decides the stored position. Drawing, picking and outlines are untouched: they
// already use the stored position and the sprite frame, so they agree with the placement by construction.
import { kindOf } from "./assets.js";

const CELL = 30, ALPHA_MIN = 8;
const EXCLUDED = new Set(["portal", "orb"]);

/** Pure maths. `b` = visible bounds relative to the sprite centre, y up: { l, r, b, t } in game units. */
export function anchorOrigin(b, cell) {
  const width = b.r - b.l, cellsWide = Math.max(1, Math.round(width / CELL));
  const bottom = cell.y - CELL / 2;                    // bottom edge of the clicked cell
  if (cellsWide >= 2) return { x: cell.x - CELL / 2 - b.l, y: bottom - b.b };   // bottom-left
  return { x: cell.x - (b.l + b.r) / 2, y: bottom - b.b };                       // bottom-centre
}

/** Visible (non-transparent) bounds of a sprite, relative to its centre in game units, or null. */
export function visibleBounds(sprite) {
  if (sprite.vis !== undefined) return sprite.vis;
  let vis = null;
  const canvases = sprite.layers?.map((l) => l.entry?.img).filter((i) => i && typeof i.getContext === "function") ?? [];
  if (canvases.length && canvases.length === sprite.layers.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, ok = true;
    for (const c of canvases) {
      try {
        const { data, width, height } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
        const ux = sprite.w / width, uy = sprite.h / height;           // game units per pixel
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] < ALPHA_MIN) continue;
          x0 = Math.min(x0, x * ux); x1 = Math.max(x1, (x + 1) * ux);
          y0 = Math.min(y0, y * uy); y1 = Math.max(y1, (y + 1) * uy);
        }
      } catch { ok = false; }
    }
    if (ok && x1 > x0) vis = { l: x0 - sprite.w / 2, r: x1 - sprite.w / 2, t: sprite.h / 2 - y0, b: sprite.h / 2 - y1 };
  }
  sprite.vis = vis;   // sprites are cached objects; placeholders and unreadable art stay null
  return vis;
}

/** Stored position for placing object `id` on the cell whose centre is `cell`. */
export function placementPos(assets, id, cell) {
  if (EXCLUDED.has(kindOf(id))) return cell;
  const vis = visibleBounds(assets.sprite(id));
  if (!vis) return cell;
  const o = anchorOrigin(vis, cell);
  return { x: +o.x.toFixed(3), y: +o.y.toFixed(3) };
}
