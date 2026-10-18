# gdlvl.js

Read, edit and write Geometry Dash `.gdlvl` level files from JavaScript (Node 18+ and browsers).

```js
import { readFileSync, writeFileSync } from "node:fs";
import { Level, inRect } from "./src/gdlvl.js";

const level = Level.fromFileText(readFileSync("level.gdlvl", "utf8"));

level.add(8, 900, 15, { rotation: 90, groups: "5" }); // add an object
level.remove(inRect(790, 0, 800, 10));                // delete objects in an area
level.update({ id: 1 }, { mainColor: 1004 });         // edit properties
level.move({ id: 1 }, 0, 30);                         // shift objects
level.setColor(1000, 20, 20, 60);                     // background colour

writeFileSync("out.gdlvl", level.toFileText());
```

## Format

- `.gdlvl` = base64url( gzip( plist XML ) )
- The plist is a flat dict of level fields (`k2` name, `k4` level data, `k48` object count, ...)
- `k4` = base64url( gzip( `header;obj;obj;...` ) )
- An object is `key,value,key,value,...` (1 = object ID, 2 = x, 3 = y, ...)

Unknown fields and object properties are preserved on save. The `k48` object count is kept in sync automatically.

## Browser use

Node uses the built-in `zlib`. Bundlers pick `src/codec.browser.js` through the `browser` condition in `package.json`; it needs `npm install fflate`. The browser codec is untested so far.

## Test

```
node test/demo.mjs test/fixtures/sample.gdlvl /tmp/out.gdlvl
```

Checks a lossless round trip, applies some edits, and re-reads the result.

## Known gaps

- Property names in `PROPS` are a starting point; verify against real levels.
- Objects in the sample carry a `155,1` property whose meaning is unknown. Objects added through `add()` don't include it.
- Edited levels have not yet been loaded in the game.
