# Plan: static browser level editor

Goal: one static page (no server, no build step, hostable on GitHub Pages) that imports a `.gdlvl`,
shows it with the game's real textures, lets you edit it visually, and exports a `.gdlvl` back.
It reuses the library in `src/` unchanged, so the editor and the scripting API edit the same model.

Status: **plan only, nothing built yet.**

## Gate before building: does the game accept our files?

Every export so far is untested in the game. First step is importing `examples/test-level.gdlvl`
into Geometry Dash and playing it. If the game rejects it, or objects look wrong, fix the library
first (most likely suspects: missing editor defaults on objects added with `add()`, the `k48`
count, header fields). An editor built on a writer that doesn't work is wasted effort.

## Textures: loaded from the user's own game, never shipped

The spritesheets are RobTop's artwork. They stay out of the repo and the hosted page. Instead:

- The page asks the user to drop the sheet files from their own install (Steam:
  `Geometry Dash/Resources/`). As far as I know the relevant files are `GJ_GameSheet*.png` with a
  matching `.plist` each (several numbered sheets, plus glow and other sheets, each in `-uhd`,
  `-hd` and plain quality). Not verified from here; the first task is to look at the folder.
- Pick `-uhd` when present (best quality), fall back to `-hd`, then plain.
- Parse the `.plist` (cocos2d TexturePacker format: per-frame rectangle, rotated flag, offset and
  source size). The library already has a GD-flavoured plist reader; the sheet format is the
  standard Apple plist, so it needs its own small parser. `gd-plist-parser` on npm (MIT) can
  serve as a reference for the format.
- Cache the files in IndexedDB so the user only drops them once per browser.
- No textures loaded: draw coloured placeholder shapes (square, spike, circle, ...) so the editor
  is still usable, and so tests don't need the artwork.

## Missing data: object ID to sprite frame name

We have object IDs, names, classes and properties. We do **not** have the table that says object 8
is drawn with frame `spike_01_001.png` (and which extra frames are its detail layer). Options, best
first:

1. A community-published dump, if one exists with a licence that allows using it. Needs searching.
2. Export it from the running game with a small Geode mod (the game's object toolbox knows the
   frame for every ID), saved as `data/object-frames.json`. The user would have to run it, since
   this needs their game.
3. Guess from names and the sheet's frame names. Fragile; placeholders cover the rest.

## Architecture

```
web/
  index.html            import map + app shell
  app/
    state.js            Level, selection, view; single place that mutates the model
    history.js          undo/redo (snapshot of objects; cheap at these sizes)
    render.js           canvas drawing, culling, tinting
    sheets.js           load PNG + plist, frame lookup, IndexedDB cache
    input.js            mouse/keyboard tools
    panels/             palette, properties, colours, triggers
  vendor/fflate.js      vendored (MIT) so there is no CDN or build step
```

- Import map: `"#codec" -> src/codec.browser.js`, `"fflate" -> vendor/fflate.js`. Node's
  `package.json` `imports` field does not apply in browsers, so the import map replaces it.
  (Check early that the browser accepts a `#codec` key; if not, rename the specifier.)
- The page imports `../src/gdlvl.js` directly. No duplicated logic.
- Rendering: Canvas 2D with viewport culling. Fine for thousands of objects; move to WebGL
  (PixiJS) only if profiling says so.
- Sprites are white-ish base art tinted by colour channels. Resolve each object's `color_1` /
  `color_2` channel through the header colours, tint on an offscreen canvas, cache per
  (frame, colour). Draw base then detail layer; honour opacity and blending.
- Draw order: z layer, then z order, then file order.
- Coordinates: game units, y up. Grid is 30 units. Ground line at y = 0 (the cell centre is 15).

## Features, in build order

1. **Viewer**: open file, pan and zoom, placeholder shapes, colour channels, background colour,
   object count, name shown on hover.
2. **Textures**: sheet loading, frame lookup, tinting, rotation, flips, scale.
3. **Selection and transform**: click and box select, drag to move with 30-unit snap, arrow-key
   nudge, rotate, flip, scale, delete, duplicate, copy and paste.
4. **Palette**: search by name (`findObjects`), grouped by class, click to place at cursor.
5. **Property panel**: generated from `obj.properties()`. Typed inputs by schema type: number,
   checkbox, enum dropdown, group list. Multi-select edits apply to every selected object.
   Unknown keys shown read-only so nothing is hidden.
6. **Undo and redo**, plus autosave to IndexedDB so a closed tab loses nothing.
7. **Colour channel editor**: list channels, edit RGB, opacity, blending.
8. **Triggers**: list view (trigger, target group, position), draw a line from a trigger to its
   target group, "select group" shortcut, create triggers from the palette with the property panel.
   Live preview of triggers playing is a stretch goal, not part of the first version.
9. **Export**: download `.gdlvl`, warn if `validate()` reports keys outside the schema.
10. **Polish and deploy**: README with screenshots, GitHub Pages workflow, credit footer.

## Scope reality check

"Everything in the normal editor" is years of work for the game's authors. A realistic first
release is steps 1 to 6: view, select, move, place, edit properties, undo, export. Later steps
add on top of the same model. Things deliberately out of scope for now: playing the level,
song and sound handling, level upload, editor layers UI, free-move and warp tools, custom
particle editing.

## Testing

- Library: `npm test` (already exists). Add a golden-file test per feature.
- Page: Playwright (headless Chromium) with placeholder rendering, so no game assets are needed:
  load a fixture level, click, drag, edit a property, undo, export, and compare the exported
  file's objects with the expected result.
- Visual check against the real game: import the exported level in Geometry Dash and compare.

## Legal and credit

- No game textures or sheets in the repo or on the hosted page.
- Keep `NOTICE.md` credit for GD Info Explorer data, and show it in the page footer.
- Check the licence of any frame-name dump before using it.

## Open questions

- Where to get the object ID to frame mapping (above)?
- Which sheets and quality levels does the current game version ship, and are any frames rotated
  in the atlas? (Decided by looking at the actual files.)
- Should the first release support only `.gdlvl`, or also the older GDShare `.gmd` / `.gmd2` files?
