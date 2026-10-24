# gdlvl.js

Read, edit and write Geometry Dash `.gdlvl` level files from JavaScript (Node 18+ and browsers).

```js
import { readFileSync, writeFileSync } from "node:fs";
import { Level, inRect } from "./src/gdlvl.js";

const level = Level.fromFileText(readFileSync("level.gdlvl", "utf8"));

level.add(8, 900, 15, { rotation: 90, groups: [5] });   // add an object
level.remove(inRect(790, 0, 800, 10));                  // delete objects in an area
level.update({ id: 1 }, { color_1: 1004 });             // edit properties
level.move({ id: 1 }, 0, 30);                           // shift objects
level.setColor(1000, 20, 20, 60);                       // background colour

// Triggers are objects too. Properties are checked against the object's class.
level.add(901, 300, 105, {                              // 901 = Move trigger
  target_group: 5, move_x: 120, duration: 1.5, easing: "ease_in_out",
});

writeFileSync("out.gdlvl", level.toFileText());
```

## Properties

Each object's class comes from its object ID, and the class decides which properties exist, what
they are called and what type they have (see `data/schema.json`).

```js
const t = level.find({ id: 901 })[0];
t.className;            // "MoveTrigger"
t.get("easing");        // "ease_in_out"  (enums read as names)
t.set("move_x", 50);    // names or raw key numbers: t.set(28, 50)
t.set("moveX", 50);     // camelCase also works
t.set("move_z", 1);     // throws: Unknown property "move_z" for MoveTrigger ...
t.properties();         // every property of this class with its current value
level.validate();       // objects holding keys their class doesn't define
```

- Values are typed: numbers for `Int`/`Float`, booleans for `Bool`, `number[]` for group lists.
- `level.find({ groups: 5 })` matches objects that are in group 5.
- `classOf(id)`, `fieldsOf(className)`, `idsForClass(className)` expose the schema directly,
  e.g. to build a property panel for an editor.

## Object names

3,986 object IDs have names, for building an object palette or searching by name.

```js
import { objectName, findObjects } from "./src/gdlvl.js";

objectName(8);                     // "Black Gradient Spike"
findObjects("move trigger");       // [{ id: 901, name: "Move Trigger", className: "MoveTrigger" }]
findObjects("spike black", 20);    // every word must match, in any order; second argument limits results
level.objects[0].name;             // name of an object already in a level
```

## Format

- `.gdlvl` = base64url( gzip( plist XML ) )
- The plist is a flat dict of level fields (`k2` name, `k4` level data, `k48` object count, ...)
- `k4` = base64url( gzip( `header;obj;obj;...` ) )
- An object is `key,value,key,value,...` (1 = object ID, 2 = x, 3 = y, ...)

Unknown fields and object properties are preserved on save. The `k48` object count is kept in sync
automatically.

## Browser use

Node uses the built-in `zlib`. Browsers and bundlers use `src/codec.browser.js` (a small built-in gzip reader/writer, no dependencies) through the `browser` condition
in `package.json`. Exported files from the browser codec are not compressed (the game reads them fine).

## Development

```
npm test                 # schema and round-trip tests
npm run build:data       # regenerate src/schema-data.js and src/names-data.js from data/
node test/demo.mjs test/fixtures/sample.gdlvl /tmp/out.gdlvl
```

## Known gaps

- Edited levels have not yet been loaded in the game.
- Objects added with `add()` get only the properties you give them, not the editor's defaults
  (for example `color_1_index`, which every object in the sample level carries).
- Object names are the site's descriptive names (for example "Black Gradient Spike"), not the
  in-game editor's tab/category layout.

## Credits

The property schema and object names come from
[GD Info Explorer](https://flowvix.github.io/gd-info-explorer/).
Thanks to Alphalaneous and the community for naming the objects. See [NOTICE.md](NOTICE.md).
