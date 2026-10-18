// Schema access: which properties (key number, name, type) each kind of object has.
//
// Data comes from GD Info Explorer (see NOTICE.md). Shape:
//   types:        name -> { type: "builtin"|"alias"|"enum", ... }
//   classes:      name -> { inherits: [class...], fields: [{ name, id, type, note }] }
//   idClasses:    objectId -> class name (any object ID not listed uses defaultClass)
//   defaultClass: "Common"

import data from "./schema-data.js";

const { types, classes, idClasses, defaultClass } = data;

const resolvedCache = new Map();

/** Class name for an object ID (e.g. 901 -> "MoveTrigger"; unlisted IDs -> "Common"). */
export function classOf(objectId) {
  return idClasses[String(objectId)] ?? defaultClass;
}

/** All known class names. */
export const classNames = () => Object.keys(classes);

/** Object IDs that use a given class, e.g. idsForClass("ColorTrigger"). */
export function idsForClass(className) {
  return Object.entries(idClasses).filter(([, c]) => c === className).map(([id]) => Number(id));
}

/**
 * Fields of a class including everything inherited, as
 * { byName: Map<name, field>, byKey: Map<keyString, field> }. Parents come first;
 * a child field with the same name overrides the parent's.
 */
export function fieldsOf(className) {
  let r = resolvedCache.get(className);
  if (r) return r;
  const cls = classes[className];
  if (!cls) throw new Error(`Unknown object class "${className}"`);
  const byName = new Map();
  const add = (list, from) => { for (const f of list) byName.set(f.name, { ...f, from }); };
  const visit = (name, seen) => {
    if (seen.has(name)) return;
    seen.add(name);
    const c = classes[name];
    for (const p of c.inherits) visit(p, seen);
    add(c.fields, name);
  };
  visit(className, new Set());
  const byKey = new Map();
  for (const f of byName.values()) if (!byKey.has(String(f.id))) byKey.set(String(f.id), f);
  r = { byName, byKey };
  resolvedCache.set(className, r);
  return r;
}

/** Follow aliases (GroupID -> Int) to the real type definition: { name, kind: "builtin"|"enum", variants? }. */
export function resolveType(typeName) {
  let name = typeName, def = types[name];
  for (let i = 0; def && def.type === "alias" && i < 10; i++) { name = def.of; def = types[name]; }
  if (!def) return { name: typeName, kind: "builtin" };
  return { name, kind: def.type, variants: def.variants };
}

// ---- value coding: file strings <-> JS values

const num = (s) => (s === "" || s == null || isNaN(s) ? s : Number(s));

/** Decode a raw file string to a JS value according to a schema type name. */
export function decodeValue(typeName, raw) {
  const t = resolveType(typeName);
  if (t.kind === "enum") {
    const n = Number(raw);
    return t.variants.find((v) => v.value === n)?.name ?? num(raw);
  }
  switch (t.name) {
    case "Bool": return raw === "1";
    case "Int": case "Float": return num(raw);
    case "GroupList": return raw === "" ? [] : raw.split(".").map(Number);
    default: return raw; // String, HSVString, ParticleString, RemapList, ...: kept as the raw string
  }
}

/** Encode a JS value to the raw file string for a schema type name. */
export function encodeValue(typeName, value) {
  const t = resolveType(typeName);
  if (t.kind === "enum") {
    if (typeof value === "string" && isNaN(value)) {
      const v = t.variants.find((x) => x.name === value);
      if (!v) throw new Error(`"${value}" is not a ${t.name} (try: ${t.variants.map((x) => x.name).join(", ")})`);
      return String(v.value);
    }
    return String(value);
  }
  switch (t.name) {
    case "Bool": return value === true || value === 1 || value === "1" ? "1" : "0";
    case "GroupList": return Array.isArray(value) ? value.join(".") : String(value);
    default: return String(value);
  }
}
