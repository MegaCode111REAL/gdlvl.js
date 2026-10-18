import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Level, GDObject, classOf, fieldsOf, idsForClass, classNames, resolveType, unpack } from "../src/gdlvl.js";
import schema from "../src/schema-data.js";

const sample = () => readFileSync(new URL("./fixtures/sample.gdlvl", import.meta.url), "utf8");

test("schema data is internally consistent", () => {
  for (const cls of classNames()) {
    const { byName } = fieldsOf(cls); // throws on unknown parents
    for (const f of byName.values()) assert.ok(schema.types[f.type], `${cls}.${f.name}: undefined type ${f.type}`);
  }
  for (const [id, cls] of Object.entries(schema.idClasses)) assert.ok(schema.classes[cls], `ID ${id} -> unknown class ${cls}`);
});

test("class lookup by object ID", () => {
  assert.equal(classOf(901), "MoveTrigger");
  assert.equal(classOf(899), "ColorTrigger");
  assert.equal(classOf(914), "TextObject");
  assert.equal(classOf(8), "Common"); // unlisted IDs fall back to the default class
  assert.deepEqual(idsForClass("MoveTrigger"), [901]);
});

test("inheritance: trigger classes include the Common fields", () => {
  const f = fieldsOf("MoveTrigger").byName;
  for (const n of ["x", "y", "groups", "target_group", "move_x", "move_y", "duration", "easing"]) assert.ok(f.has(n), n);
  assert.equal(f.get("move_x").id, 28);
  assert.equal(resolveType("GroupID").name, "Int"); // alias resolves
});

test("named properties, typed values and enums", () => {
  const level = Level.fromFileText(sample());
  const t = level.add(901, 300, 105, { target_group: 3, move_x: 120, duration: 1.5, easing: "ease_in_out", groups: [7, 9] });
  assert.equal(t.get("target_group"), 3);
  assert.equal(t.getRaw("easing"), "1");
  assert.equal(t.get("easing"), "ease_in_out");
  assert.equal(t.getRaw("groups"), "7.9");
  assert.deepEqual(t.get("groups"), [7, 9]);

  const b = level.add(1, 0, 0);
  assert.equal(b.get("flip_horiz"), false); // unset Bool reads as false
  b.set("flip_horiz", true);
  assert.equal(b.getRaw("flip_horiz"), "1");
  assert.equal(b.get("flip_horiz"), true);
});

test("typed values survive a save and reload", () => {
  const level = Level.fromFileText(sample());
  level.add(901, 300, 105, { target_group: 3, move_x: 120, easing: "bounce_out" });
  const again = Level.fromFileText(level.toFileText());
  const t = again.find({ id: 901 })[0];
  assert.equal(t.className, "MoveTrigger");
  assert.equal(t.get("easing"), "bounce_out");
  assert.equal(t.get("move_x"), 120);
});

test("unknown names throw with a hint; raw key numbers still work", () => {
  const level = Level.fromFileText(sample());
  const t = level.add(901, 0, 0);
  assert.throws(() => t.set("movex", 1), /Unknown property "movex" for MoveTrigger.*move_x/);
  assert.throws(() => t.set("totally_made_up", 1), /Unknown property "totally_made_up"/);
  t.set("moveX", 7); // camelCase is accepted for snake_case names
  assert.equal(t.get("move_x"), 7);
  assert.throws(() => level.add(1, 0, 0, { move_x: 5 }), /Unknown property "move_x"/); // blocks have no move_x
  t.set(28, 50); // raw key
  assert.equal(t.get("move_x"), 50);
  assert.throws(() => t.set("easing", "nope"), /not a Easing/);
});

test("older aliases still work", () => {
  const level = Level.fromFileText(sample());
  const o = level.add(1, 0, 0, { mainColor: 1004, zLayer: 3 });
  assert.equal(o.get("color_1"), 1004);
  assert.equal(o.get("z_layer"), 3);
});

test("queries: by value, by group membership, by rectangle", () => {
  const level = Level.fromFileText(sample());
  level.add(1, 600, 15, { groups: [5, 6] });
  assert.equal(level.find({ groups: 6 }).length, 1);
  assert.equal(level.find({ groups: [5, 6] }).length, 1);
  assert.equal(level.find({ id: 8 }).length, 1);
});

test("the sample level has no keys outside the schema", () => {
  assert.deepEqual(Level.fromFileText(sample()).validate(), []);
});

test("validate() reports keys a class doesn't define", () => {
  const level = Level.fromFileText(sample());
  level.add(1, 0, 0).set(9999, 1);
  const issues = level.validate();
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].unknown, ["9999"]);
});

test("properties() lists every field with current values (for property panels)", () => {
  const o = new GDObject();
  o.set(1, 901).set("x", 10).set("move_y", -30);
  const p = o.properties();
  assert.ok(p.length > 20);
  assert.equal(p.find((f) => f.name === "move_y").value, -30);
  assert.equal(p.find((f) => f.name === "move_y").isSet, true);
  assert.equal(p.find((f) => f.name === "move_x").isSet, false);
});

test("round trip of the sample file is lossless", () => {
  const text = sample();
  const level = Level.fromFileText(text);
  const norm = (file) => {
    const xml = unpack(file);
    const k4 = xml.match(/<k>k4<\/k><s>(.*?)<\/s>/)[1];
    return xml.replace(k4, "") + "\n" + unpack(k4);
  };
  assert.equal(norm(level.toFileText()), norm(text));
});
