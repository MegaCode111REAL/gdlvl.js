# Editor art

## Original Geometry Dash textures

The editor now reads `data/spritesheets/GJ_GameSheet-uhd.png`, `GJ_GameSheet02-uhd.png`, and `GJ_GameSheet03-uhd.png` together with each matching `.plist`. It crops atlas frames in the browser and respects the plist texture rectangle, rotated-frame flag, source size, and sprite offset. Use **Textures > Disable original textures** to compare with placeholders/custom art. The ID-to-frame table is incomplete, so frames are selected from explicit common-object mappings and conservative name-based matching; an object with no reliable match falls back to its placeholder.

The editor draws every object from this folder. Until you add your own art, each object gets a
**placeholder** chosen from its name (block, slab, spike, slope, pad, orb, portal, saw, trigger, ...);
the files are in `placeholders/`.

## Your own art

Put images in `objects/`, named by object ID:

| File               | Meaning                                                              |
|--------------------|----------------------------------------------------------------------|
| `8.png`            | base layer, **tinted** by the object's `color_1` colour channel      |
| `8_detail.png`     | optional detail layer, tinted by the `color_2` channel               |
| `8_fixed.png`      | optional layer drawn as-is on top (not tinted)                       |

PNG, WebP, SVG, GIF and JPG all work. Draw tinted layers in white and grey: the tint multiplies the
colour, so white becomes the channel colour and black stays black.

**Size:** 4 pixels per game unit, so a 30-unit block is 120 x 120 px. The image's size sets the
object's size in the editor. Use `object-names.txt` in `data/` for IDs.

After adding files, rebuild the list the page reads:

```
npm run build:assets
```

An object without art keeps its placeholder, so you can replace things gradually.

## Trying art without rebuilding

In the editor, **Textures > Load files...** accepts the same file names (for example `8.png`,
`8_detail.png`). They apply immediately and are remembered in your browser, on top of whatever is
in this folder. An optional `manifest.json` with `{ "pxPerUnit": 8 }` changes the scale for a set
you load that way. **Textures > Clear loaded** removes them again.

## Placeholders

`npm run build:assets -- --placeholders` rewrites the placeholder SVGs (this overwrites edits to
them). Without that flag existing placeholders are left alone, so you can restyle them.
