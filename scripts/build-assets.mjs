// Builds web/assets/manifest.json, and writes the placeholder SVGs if they are missing.
//
//   node scripts/build-assets.mjs                 scan web/assets/objects/ and rewrite the manifest
//   node scripts/build-assets.mjs --placeholders  also rewrite the placeholder SVGs (overwrites edits)
//
// Your own art goes in web/assets/objects/, named by object ID (see web/assets/README.md).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";

const root = new URL("../web/assets/", import.meta.url);
const PX = 4; // pixels per game unit in the placeholders (a 30-unit block is 120 px)

// kind -> size in game units, and whether the colour channel tints it.
const KINDS = {
  block: { size: [30, 30], tint: true }, slab: { size: [30, 15], tint: true },
  spike: { size: [30, 30], tint: true }, halfspike: { size: [30, 15], tint: true },
  slope: { size: [30, 30], tint: true }, wideslope: { size: [60, 30], tint: true },
  pad: { size: [30, 12], tint: true }, orb: { size: [30, 30], tint: true },
  portal: { size: [32, 86], tint: false }, saw: { size: [60, 60], tint: true },
  trigger: { size: [30, 30], tint: false }, text: { size: [60, 30], tint: true },
  deco: { size: [30, 30], tint: true }, start: { size: [30, 30], tint: false },
};

const ink = `fill="#fff" stroke="#000" stroke-opacity=".6" stroke-width="4" stroke-linejoin="round"`;
const line = `fill="none" stroke="#000" stroke-opacity=".35" stroke-width="3"`;
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;

const DRAW = {
  block: (w, h) => svg(w, h, `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" ${ink}/><rect x="14" y="14" width="${w - 28}" height="${h - 28}" ${line}/>`),
  slab: (w, h) => svg(w, h, `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" ${ink}/><rect x="10" y="10" width="${w - 20}" height="${h - 20}" ${line}/>`),
  spike: (w, h) => svg(w, h, `<polygon points="${w / 2},4 ${w - 4},${h - 4} 4,${h - 4}" ${ink}/>`),
  halfspike: (w, h) => svg(w, h, `<polygon points="${w / 2},4 ${w - 4},${h - 4} 4,${h - 4}" ${ink}/>`),
  slope: (w, h) => svg(w, h, `<polygon points="4,${h - 4} ${w - 4},${h - 4} ${w - 4},4" ${ink}/>`),
  wideslope: (w, h) => svg(w, h, `<polygon points="4,${h - 4} ${w - 4},${h - 4} ${w - 4},4" ${ink}/>`),
  pad: (w, h) => svg(w, h, `<path d="M4,${h - 4} Q${w / 2},-${h / 2} ${w - 4},${h - 4} Z" ${ink}/>`),
  orb: (w, h) => svg(w, h, `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 4}" ${ink}/><circle cx="${w / 2}" cy="${h / 2}" r="${w / 4}" ${line}/>`),
  portal: (w, h) => svg(w, h, `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 6}" ry="${h / 2 - 6}" fill="#35d4ff" fill-opacity=".35" stroke="#0a7a99" stroke-width="8"/><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 5}" ry="${h / 3}" fill="none" stroke="#0a7a99" stroke-opacity=".6" stroke-width="5"/>`),
  saw: (w, h) => {
    const cx = w / 2, cy = h / 2, pts = [];
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? w * 0.34 : w * 0.48, a = (i * Math.PI) / 8;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return svg(w, h, `<polygon points="${pts.join(" ")}" ${ink}/><circle cx="${cx}" cy="${cy}" r="${w * 0.1}" ${line}/>`);
  },
  trigger: (w, h) => svg(w, h, `<rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="16" fill="#ffc83d" stroke="#8a5a00" stroke-width="6"/><polygon points="66,18 36,66 58,66 50,102 86,50 62,50" fill="#8a5a00"/>`),
  text: (w, h) => svg(w, h, `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="10" ${ink} stroke-dasharray="14 8"/><text x="${w / 2}" y="${h / 2 + 22}" font-family="sans-serif" font-size="64" text-anchor="middle" fill="#000" fill-opacity=".55">Aa</text>`),
  deco: (w, h) => svg(w, h, `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="22" ${ink} stroke-dasharray="12 8"/>`),
  start: (w, h) => svg(w, h, `<rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="16" fill="#47d16b" stroke="#17692f" stroke-width="6"/><polygon points="44,32 92,60 44,88" fill="#17692f"/>`),
};

mkdirSync(new URL("placeholders/", root), { recursive: true });
mkdirSync(new URL("objects/", root), { recursive: true });

const force = process.argv.includes("--placeholders");
const placeholders = {};
for (const [kind, { size, tint }] of Object.entries(KINDS)) {
  const file = `placeholders/${kind}.svg`;
  placeholders[kind] = { file, size, tint };
  if (force || !existsSync(new URL(file, root))) writeFileSync(new URL(file, root), DRAW[kind](size[0] * PX, size[1] * PX));
}

// Custom art: objects/<id>.png (base, tinted by color_1), <id>_detail.png (tinted by color_2),
// <id>_fixed.png (drawn as-is on top). png, webp, svg, gif and jpg are accepted.
const objects = {};
for (const f of readdirSync(new URL("objects/", root))) {
  const m = f.match(/^(\d+)(?:_(detail|fixed))?\.(png|webp|svg|gif|jpe?g)$/i);
  if (!m) continue;
  (objects[m[1]] ??= {})[m[2] ?? "base"] = `objects/${f}`;
}

writeFileSync(new URL("manifest.json", root), JSON.stringify({ pxPerUnit: PX, placeholders, objects }, null, 1) + "\n");
console.log(`manifest: ${Object.keys(placeholders).length} placeholder kinds, ${Object.keys(objects).length} custom objects`);
