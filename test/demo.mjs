// Usage: node test/demo.mjs <input.gdlvl> <output.gdlvl>
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert";
import { Level, unpack, inRect } from "../src/gdlvl.js";

const [, , inPath, outPath] = process.argv;
const text = readFileSync(inPath, "utf8");

// 1. Lossless round trip (compare the decompressed XML + level string, not gzip bytes)
const level = Level.fromFileText(text);
const again = Level.fromFileText(level.toFileText());
// k4 is re-compressed on save (different gzip bytes, same content), so decode it before comparing.
const norm = (file) => {
  const xml = unpack(file);
  const k4 = xml.match(/<k>k4<\/k><s>(.*?)<\/s>/)[1];
  return xml.replace(k4, "") + "\n" + unpack(k4);
};
assert.strictEqual(norm(level.toFileText()), norm(text), "file content changed on round trip");
assert.deepStrictEqual(again.objects.map(String), level.objects.map(String), "objects changed");
assert.deepStrictEqual(again.headerTokens, level.headerTokens, "header changed");
console.log(`round trip OK: "${level.name}", ${level.objects.length} objects, ${level.colors.length} colour channels`);
console.log(JSON.stringify(level.objects, null, 0));

// 2. Edits
level.add(8, 900, 15);                                   // spike at (900, 15)
level.add(8, 930, 15, { rotation: 90 });                 // rotated spike
level.add(1, 960, 15, { groups: "5", mainColor: 1004 }); // block in group 5
level.setColor(1000, 20, 20, 60);                        // background colour
level.setColor(1004, 255, 120, 0);                       // object colour
const removed = level.remove(inRect(790, 0, 800, 10));   // delete the object near (795, 6)
level.move({ id: 1 }, 0, 30);                            // shift all blocks up one block
console.log("removed", removed, "objects now", level.objects.length);

// 3. Save, re-load, verify
const out = level.toFileText();
const check = Level.fromFileText(out);
assert.strictEqual(check.objects.length, level.objects.length);
assert.strictEqual(check.field("k48"), String(level.objects.length), "k48 object count not synced");
assert.strictEqual(check.headerGet("kS38").split("|")[0].split("_")[1], "20");
writeFileSync(outPath, out);
console.log("edited file verified and written:", outPath);
console.log(JSON.stringify(check.objects, null, 0));
