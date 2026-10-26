// Side panels: object palette, property editor, colour channels, level info.
import { findObjects, fieldsOf, resolveType, objectName, classOf } from "../../src/gdlvl.js";

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) e.append(kid);
  return e;
};

// ---------------------------------------------------------------- palette

export function initPalette({ store, assets }) {
  const q = document.getElementById("pal-q"), cls = document.getElementById("pal-class"), list = document.getElementById("pal-list");
  const ALL = findObjects("", 10000);
  const classes = [...new Set(ALL.map((o) => o.className))].sort();
  const isTrigger = (c) => c === "Trigger" || c.endsWith("Trigger");
  cls.append(el("option", { value: "" }, "All objects"), el("option", { value: "__triggers" }, "All triggers"),
    ...classes.map((c) => el("option", { value: c }, c === "Common" ? "Common (blocks, spikes, decoration, ...)" : c)));

  const LIMIT = 200;
  function render() {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean), c = cls.value;
    const hits = ALL.filter((o) => (!c || (c === "__triggers" ? isTrigger(o.className) : o.className === c)) &&
      (!words.length || words.every((w) => o.name.toLowerCase().includes(w) || String(o.id) === w)));
    list.replaceChildren(...hits.slice(0, LIMIT).map((o) =>
      el("li", { "data-id": o.id, role: "option", "aria-selected": store.armed === o.id, onclick: () => pick(o.id) },
        el("span", { class: "thumb" }, el("img", { src: assets.thumb(o.id), alt: "", loading: "lazy" })),
        el("span", {}, o.name, el("small", {}, `#${o.id} · ${o.className}`)))),
      ...(hits.length > LIMIT ? [el("li", { class: "more" }, `${hits.length - LIMIT} more: refine the search`)] : []));
    if (!hits.length) list.replaceChildren(el("li", { class: "more" }, "No objects match"));
  }
  function pick(id) { store.armed = store.armed === id ? null : id; store.emit("armed"); }
  function mark() { for (const li of list.children) li.setAttribute("aria-selected", String(Number(li.dataset.id) === store.armed)); }

  q.addEventListener("input", render); cls.addEventListener("change", render);
  store.on((t) => { if (t === "armed") mark(); });
  assets.onUpdateList = render;
  render();
}

// ---------------------------------------------------------------- properties

const CORE = ["x", "y", "rotation", "scale", "groups", "z_layer", "z_order", "color_1", "color_2"];

export function initProps({ store }) {
  const root = document.getElementById("props");

  function control(f, objs) {
    const values = objs.map((o) => (fieldsOf(o.className).byName.has(f.name) ? o.get(f.name) : undefined));
    const same = values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]));
    const v = same ? values[0] : undefined, t = resolveType(f.type), apply = (val) => store.setProp(objs, f.name, val);
    if (t.name === "Bool" && t.kind !== "enum") {
      const c = el("input", { type: "checkbox", id: `p-${f.name}`, onchange: () => apply(c.checked) });
      c.checked = same ? !!v : false; c.indeterminate = !same;
      return c;
    }
    if (t.kind === "enum") {
      const s = el("select", { id: `p-${f.name}`, onchange: () => s.value !== "" && apply(s.value) },
        ...(same ? [] : [el("option", { value: "" }, "mixed")]), ...t.variants.map((x) => el("option", { value: x.name }, x.name)));
      if (same) s.value = typeof v === "string" ? v : (t.variants.find((x) => x.value === v)?.name ?? t.variants[0].name);
      return s;
    }
    if (t.name === "GroupList") {
      const i = el("input", { type: "text", id: `p-${f.name}`, placeholder: same ? "none" : "mixed", title: "Group IDs separated by commas",
        onchange: () => apply(i.value.split(/[\s,.]+/).filter(Boolean).map(Number).filter(Number.isFinite)) });
      i.value = same && Array.isArray(v) ? v.join(", ") : "";
      return i;
    }
    if (t.name === "Int" || t.name === "Float") {
      const i = el("input", { type: "number", step: "any", id: `p-${f.name}`, placeholder: same ? "" : "mixed",
        onchange: () => i.value !== "" && apply(Number(i.value)) });
      i.value = same && v !== undefined ? v : "";
      return i;
    }
    const i = el("input", { type: "text", id: `p-${f.name}`, placeholder: same ? "" : "mixed", onchange: () => apply(i.value) });
    i.value = same && v !== undefined ? v : "";
    return i;
  }

  function render() {
    const objs = [...store.selection];
    if (!objs.length) { root.replaceChildren(el("p", { class: "muted" }, "Nothing selected. Click an object, or drag a box around several.")); return; }
    const first = objs[0], fields = fieldsOf(first.className).byName;
    const sameClass = objs.every((o) => o.className === first.className);
    const title = objs.length === 1
      ? el("div", { class: "sel-title" }, `${first.name ?? "Unnamed object"}`, el("small", {}, `#${first.objectId} · ${first.className}`))
      : el("div", { class: "sel-title" }, `${objs.length} objects`, el("small", {}, sameClass ? first.className : "mixed classes: edits apply where the property exists"));

    const set = (name) => objs.some((o) => o.has(name));
    // Always show the properties specific to this kind of object (a trigger's target, duration, ...);
    // the general ones (hide, no touch, ...) appear once set, or via "Add property".
    const own = (n) => fields.get(n).from !== "Common";
    const shown = [...CORE.filter((n) => fields.has(n)), ...[...fields.keys()].filter((n) => !CORE.includes(n) && (own(n) || set(n)))];
    const rows = shown.map((n) => {
      const f = fields.get(n);
      return el("div", { class: "field" },
        el("label", { for: `p-${n}`, title: `key ${f.id}${f.note ? ": " + f.note : ""}` }, n),
        control(f, objs),
        CORE.includes(n) || !set(n) ? el("span") : el("button", { class: "x", title: "Remove this property", "aria-label": `Remove ${n}`, onclick: () => { store.removeProp(objs, n); render(); } }, "✕"));
    });

    const unset = [...fields.keys()].filter((n) => !CORE.includes(n) && !own(n) && !set(n));
    const add = el("select", { "aria-label": "Add property", onchange: () => {
      if (!add.value) return;
      const f = fields.get(add.value), t = resolveType(f.type);
      const def = t.kind === "enum" ? t.variants[0].name : t.name === "Bool" ? true : t.name === "GroupList" ? [] : t.name === "Int" || t.name === "Float" ? 0 : "";
      objs.forEach((o) => fieldsOf(o.className).byName.has(add.value) && o.set(add.value, def));
      store.commit("prop"); render();
    } }, el("option", { value: "" }, "Add property…"), ...unset.map((n) => el("option", { value: n }, `${n} (${fields.get(n).type})`)));

    const unknown = objs.length === 1 ? first.unknownKeys() : [];
    root.replaceChildren(title, ...rows, el("div", { class: "field" }, add),
      ...(unknown.length ? [el("p", { class: "muted" }, `Other keys kept as-is: ${unknown.join(", ")}`)] : []));
  }

  store.on((t) => { if (!["prop", "color-live", "color", "name", "armed"].includes(t)) render(); });
  render();
}

// ---------------------------------------------------------------- colours

const CHANNEL_NAMES = { 1000: "Background", 1001: "Ground", 1002: "Line", 1003: "3DL", 1004: "Object", 1005: "Player 1", 1006: "Player 2", 1009: "Ground 2" };
const hex = (r, g, b) => "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0")).join("");

export function initColors({ store }) {
  const root = document.getElementById("colors");
  function render() {
    const rows = store.level.colors.map((entry) => {
      const d = Object.fromEntries(entry), id = Number(d["6"]);
      const input = el("input", { type: "color", id: `ch-${id}`, "aria-label": `Colour channel ${id}`,
        oninput: () => { const h = input.value; store.setChannelColor(id, parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), false); },
        onchange: () => { const h = input.value; store.setChannelColor(id, parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), true); } });
      input.value = hex(+d["1"], +d["2"], +d["3"]);
      return el("div", { class: "chan" }, el("label", { for: `ch-${id}` }, CHANNEL_NAMES[id] ? `${CHANNEL_NAMES[id]} (${id})` : `Channel ${id}`), input);
    });
    const num = el("input", { type: "number", min: "1", placeholder: "Channel ID", "aria-label": "New channel ID" });
    const add = el("button", { onclick: () => { const id = Math.floor(Number(num.value)); if (id > 0) { store.setChannelColor(id, 255, 255, 255, true); } } }, "Add");
    root.replaceChildren(...rows, el("div", { class: "row" }, num, add));
  }
  store.on((t) => { if (["load", "history", "color"].includes(t)) render(); });
  render();
}

// ---------------------------------------------------------------- level info

export function initInfo({ store }) {
  const root = document.getElementById("info"), nameInput = document.getElementById("level-name");
  const group = el("input", { type: "number", min: "1", placeholder: "Group ID", "aria-label": "Group ID" });
  const oid = el("input", { type: "number", min: "1", placeholder: "Object ID", "aria-label": "Object ID" });
  const count = el("p", { class: "muted" });
  root.replaceChildren(count,
    el("div", { class: "row" }, group, el("button", { onclick: () => group.value && store.selectByGroup(Number(group.value)) }, "Select group")),
    el("div", { class: "row" }, oid, el("button", { onclick: () => oid.value && store.selectById(Number(oid.value)) }, "Select by ID")));
  nameInput.addEventListener("change", () => store.rename(nameInput.value));
  const update = () => {
    count.textContent = `${store.level.objects.length} objects`;
    if (document.activeElement !== nameInput) nameInput.value = store.level.name ?? "";
  };
  store.on(update); update();
}

export { objectName, classOf };
