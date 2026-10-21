// Builds examples/test-level.gdlvl: a short, cube-only level for testing the import pipeline.
//   node examples/test-level.mjs
//
// It starts from test/fixtures/sample.gdlvl so the header (colour channels, settings) is one the
// game itself exported, clears the objects, and lays out a course on a 30-unit grid.
//
// Everything that can kill you is a single spike, a double spike or a block wall, spaced far apart.
// The pad, orb and triggers are placed where they can't make the level unwinnable:
// the pad and orb sit over open flat ground, the moving blocks are high above the player.
import { readFileSync, writeFileSync } from "node:fs";
import { Level } from "../src/gdlvl.js";

const root = new URL("../", import.meta.url);
const level = Level.fromFileText(readFileSync(new URL("test/fixtures/sample.gdlvl", root), "utf8"));
level.objects = [];
level.name = "gdlvl.js test level";

// Grid helpers: one block = 30 units. cell(n) is the centre of column n; row(0) is the ground row.
const cell = (n) => 15 + 30 * n;
const row = (k) => 15 + 30 * k;

// Object IDs (see data/object-names.txt)
const BLOCK = 1, SPIKE = 8, YELLOW_PAD = 35, YELLOW_ORB = 36;
const COLOR_TRIGGER = 899, MOVE_TRIGGER = 901;
const BG = 1000; // background colour channel

// Every object in a level the game exported carries color_1_index: 1, so match that.
const PADS = new Set([35, 67, 140, 1332]);
const PAD_DROP = 30 * 3 / 8; // pads sit 3/8 of a block lower than the grid
const put = (id, n, k = 0, props = {}) =>
  level.add(id, cell(n), row(k) - (PADS.has(id) ? PAD_DROP : 0), { color_1_index: 1, ...props });
const trigger = (id, n, props) => level.add(id, cell(n), row(6), props);

// ---- course -------------------------------------------------------------------------------
put(SPIKE, 16);                                   // 1. single spike (warm-up)
put(SPIKE, 24); put(SPIKE, 25);                   // 2. double spike
put(SPIKE, 33);                                   // 3. single spike
put(BLOCK, 40);                                   // 4. one-block wall: jump onto it or over it
for (const n of [47, 48, 49]) put(BLOCK, n);      // 5. staircase: 1 high ...
for (const n of [50, 51, 52]) { put(BLOCK, n); put(BLOCK, n, 1); } // ... then 2 high, then drop
put(YELLOW_PAD, 60);                              // 6. yellow pad on open ground
put(YELLOW_ORB, 66, 3);                           //    yellow orb floating over open ground
put(SPIKE, 74); put(SPIKE, 75);                   // 7. double spike
put(SPIKE, 82);                                   // 8. single spike
put(BLOCK, 88); put(SPIKE, 91);                   // 9. wall, then a spike

// ---- decoration: a row of blocks high above the course (group 1), moved by a trigger ------
for (let n = 52; n <= 56; n++) put(BLOCK, n, 9, { groups: [1] });

// ---- triggers (activate when the player passes their x position) ---------------------------
trigger(COLOR_TRIGGER, 20, { target_color: BG, red: 120, green: 40, blue: 200, duration: 1.5 });
trigger(MOVE_TRIGGER, 44, { target_group: 1, move_y: -60, duration: 2, easing: "ease_in_out" });
trigger(COLOR_TRIGGER, 55, { target_color: BG, red: 20, green: 160, blue: 90, duration: 1.5 });
trigger(COLOR_TRIGGER, 85, { target_color: BG, red: 40, green: 125, blue: 255, duration: 1.5 });

// No end trigger: the game ends the level about 5 blocks after the last object.

const out = new URL("examples/test-level.gdlvl", root);
writeFileSync(out, level.toFileText());

const problems = level.validate();
console.log(`wrote examples/test-level.gdlvl: "${level.name}", ${level.objects.length} objects, ends shortly after the last object`);
if (problems.length) console.warn("keys outside the schema:", JSON.stringify(problems));
