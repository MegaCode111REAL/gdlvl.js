// Builds examples/neon-drift.gdlvl: a ~60 second cube level in three acts.
//   node examples/fun-level.mjs
//
//   Act 1  0-20 s   normal speed   spikes, a staircase, a pad, an orb
//   Act 2  20-40 s  fast (green)   same ideas with wider gaps, because jumps travel further
//   Act 3  40-60 s  normal speed   everything together, finishing on a run of spikes
//
// No end trigger: the game ends the level about 5 blocks after the last object.
// Pads are placed 3/8 of a block lower (11.25 units) than the grid position.
import { readFileSync, writeFileSync } from "node:fs";
import { Level } from "../src/gdlvl.js";

const root = new URL("../", import.meta.url);
const level = Level.fromFileText(readFileSync(new URL("test/fixtures/sample.gdlvl", root), "utf8"));
level.objects = [];
level.name = "Neon Drift";

const SPEED = { normal: 311.58, fast: 387.42 }; // units per second
const cell = (n) => 15 + 30 * n;
const row = (k) => 15 + 30 * k;

const BLOCK = 1, SPIKE = 8, YELLOW_PAD = 35, YELLOW_ORB = 36;
const PORTAL_NORMAL = 201, PORTAL_FAST = 202;
const COLOR_TRIGGER = 899, MOVE_TRIGGER = 901;
const BG = 1000, GROUND = 1001;
const PAD_DROP = 30 * 3 / 8;
const PADS = new Set([35, 67, 140, 1332]);

const put = (id, n, k = 0, props = {}) =>
  level.add(id, cell(n), row(k) - (PADS.has(id) ? PAD_DROP : 0), { color_1_index: 1, ...props });

// ---- patterns: each takes the cursor (a column) and a gap multiplier, returns the next cursor ----
const spikes = (c, n) => { for (let i = 0; i < n; i++) put(SPIKE, c + i); };
const P = {
  single: (c, g) => { spikes(c, 1); return c + Math.round(7 * g); },
  double: (c, g) => { spikes(c, 2); return c + Math.round(8 * g); },
  triple: (c, g) => { spikes(c, 3); return c + Math.round(10 * g); },
  zigzag: (c, g) => {
    const s = Math.round(5 * g); spikes(c, 1); spikes(c + s, 1); spikes(c + 2 * s, 1);
    return c + 2 * s + Math.round(7 * g);
  },
  stairs: (c, g) => {               // three platforms, 1, 2 then 3 blocks high
    for (let i = 0; i < 3; i++)
      for (let x = 0; x < 3; x++) for (let h = 0; h <= i; h++) put(BLOCK, c + 5 * i + x, h);
    return c + 15 + Math.round(8 * g);
  },
  platform: (c, g) => {             // a long low platform with one spike on top
    for (let x = 0; x < 9; x++) put(BLOCK, c + x);
    put(SPIKE, c + 5, 1);
    return c + 9 + Math.round(7 * g);
  },
  pad: (c, g) => {                  // yellow pad launches you over four spikes
    put(YELLOW_PAD, c); spikes(c + 5, 4);
    return c + Math.round(17 * g);
  },
  orb: (c, g) => {                  // five spikes with an optional orb above the middle
    spikes(c, 5); put(YELLOW_ORB, c + 2, 3);
    return c + Math.round(12 * g);
  },
  wall: (c, g) => {                 // a block to hop onto, then a double spike after it
    put(BLOCK, c); spikes(c + 5, 2);
    return c + Math.round(13 * g);
  },
};

const fill = (c, end, names, g) => {
  for (let i = 0; c < end; i++) c = P[names[i % names.length]](c, g);
  return c;
};

// ---- the three acts -----------------------------------------------------------------------------
const A_END = Math.round((SPEED.normal * 20) / 30);                 // column reached after 20 s
const B_END = A_END + Math.round((SPEED.fast * 20) / 30);           // after 40 s
const C_END = B_END + Math.round((SPEED.normal * 19.2) / 30);       // last object lands near 59.5 s

let c = 16;
c = fill(c, A_END - 14, ["single", "single", "double", "single", "triple", "stairs", "double", "pad", "zigzag", "platform", "orb", "wall", "double"], 1);
put(PORTAL_FAST, A_END, 2);
c = fill(A_END + 6, B_END - 16, ["double", "pad", "single", "stairs", "triple", "orb", "zigzag", "wall", "platform", "double", "single"], 1.25);
put(PORTAL_NORMAL, B_END, 2);
c = fill(B_END + 6, C_END - 14, ["single", "double", "wall", "pad", "triple", "stairs", "orb", "zigzag", "platform", "double", "pad", "triple", "single"], 1);
spikes(c, 3);                                                        // finale
const lastColumn = c + 2;

// ---- decoration: blocks high above the player, bobbing in two groups ----------------------------
for (let n = 10; n < lastColumn; n += 5) put(BLOCK, n, 9, { groups: [n % 10 === 0 ? 1 : 2] });

const colAt = (t) =>
  t <= 20 ? (SPEED.normal * t) / 30
  : t <= 40 ? A_END + (SPEED.fast * (t - 20)) / 30
  : B_END + (SPEED.normal * (t - 40)) / 30;
const trigger = (id, t, props) => level.add(id, cell(Math.round(colAt(t))), row(6), props);

const palette = [[40, 125, 255], [150, 50, 220], [255, 70, 130], [20, 170, 120], [255, 150, 30], [60, 90, 200]];
for (let i = 0; i < 10; i++) {
  const [r, g, b] = palette[i % palette.length];
  trigger(COLOR_TRIGGER, 1 + i * 6, { target_color: BG, red: r, green: g, blue: b, duration: 2 });
  trigger(COLOR_TRIGGER, 1 + i * 6, { target_color: GROUND, red: r >> 1, green: g >> 1, blue: b >> 1, duration: 2 });
}
for (let i = 0; i < 14; i++)
  trigger(MOVE_TRIGGER, 2 + i * 4, { target_group: 1 + (i % 2), move_y: i % 4 < 2 ? -60 : 60, duration: 2, easing: "sine_in_out" });

writeFileSync(new URL("examples/neon-drift.gdlvl", root), level.toFileText());

const issues = level.validate();
const last = Math.max(...level.objects.filter((o) => [BLOCK, SPIKE, YELLOW_PAD, YELLOW_ORB].includes(o.objectId)).map((o) => o.get("x")));
console.log(`wrote examples/neon-drift.gdlvl: ${level.objects.length} objects, last object at column ${((last - 15) / 30).toFixed(0)}`);
console.log(`ends about ${(40 + (last + 150 - cell(B_END)) / SPEED.normal).toFixed(1)} s in`);
if (issues.length) console.warn("keys outside the schema:", JSON.stringify(issues));
