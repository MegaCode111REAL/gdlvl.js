// Object names: which ID is which block, spike, portal or trigger.
// Data: GD Info Explorer (see NOTICE.md); the names are credited there to Alphalaneous and the community.

import names from "./names-data.js";
import { classOf } from "./schema.js";

/** Name for an object ID, e.g. objectName(8) -> "Black Gradient Spike". undefined if unknown. */
export function objectName(id) {
  return names[String(id)];
}

/** How many named objects there are. */
export const objectCount = () => Object.keys(names).length;

/**
 * Search objects by name. Every word in the query must appear (case-insensitive), in any order:
 * findObjects("spike black") -> [{ id, name, className }, ...]. Results are in ID order.
 */
export function findObjects(query, limit = 100) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const [id, name] of Object.entries(names)) {
    const lower = name.toLowerCase();
    if (words.every((w) => lower.includes(w))) {
      out.push({ id: Number(id), name, className: classOf(id) });
      if (out.length >= limit) break;
    }
  }
  return out.sort((a, b) => a.id - b.id);
}
