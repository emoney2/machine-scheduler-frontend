/**
 * Match catalog swatches (catalog names, e.g. "Gator Leather · Navy Blue") to live
 * Material Inventory rows. Rules:
 *   1. an explicit entry in public/headcover-studio/swatches/inventory-map.json wins
 *      ({ "<swatch id>": "<exact Material Inventory name>" }, or null to mark "not stocked");
 *   2. otherwise every word of the colour name must appear in the inventory name, and
 *      the line's key word (gator, ostrich, metallic, vinyl, fur...) must appear too when
 *      any inventory row uses that word.
 * Returns { swatchId: inventoryName | null }.
 */
const words = (s) => String(s || "").toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter(Boolean);

const LINE_KEYS = {
  "classic leather": [],
  "gator leather": ["gator", "croc", "crocodile", "alligator"],
  "rustic gator leather": ["rustic"],
  "split-tone gator leather": ["split", "two tone", "two-tone"],
  "ostrich leather": ["ostrich"],
  "metallic leather": ["metallic"],
  "heritage leather": ["heritage"],
  "distressed leather": ["distressed"],
  "emboss patch leather": ["emboss", "embossed", "patch"],
  "premium vinyl solid": ["vinyl"],
  "fur interior lining": ["fur"],
};

export function matchInventory(swatches, rows, overrides = {}, kind = "material") {
  const inv = rows
    .map((r) => (typeof r === "string" ? { name: r } : r))
    .filter((r) => r && r.name)
    .map((r) => ({ name: String(r.name).trim(), w: new Set(words(r.name)), text: String(r.name).toLowerCase() }));
  const out = {};
  for (const s of swatches) {
    if (Object.prototype.hasOwnProperty.call(overrides, s.id)) { out[s.id] = overrides[s.id]; continue; }
    const need = words(s.name);
    const keys = LINE_KEYS[String(s.line || "").toLowerCase()] || words(s.line).slice(0, 1);
    const keyInUse = keys.length > 0 && inv.some((r) => keys.some((k) => r.text.includes(k)));
    const hits = inv.filter((r) =>
      need.every((w) => r.w.has(w)) &&
      (!keyInUse || keys.some((k) => r.text.includes(k))) &&
      // a plain colour ("Black") must not grab a speciality row ("Black Gator") from another line
      (keys.length > 0 || kind === "fur" || !Object.values(LINE_KEYS).flat().some((k) => k && r.text.includes(k))));
    hits.sort((a, b) => a.w.size - b.w.size);   // fewest extra words = closest name
    out[s.id] = hits.length ? hits[0].name : null;
  }
  return out;
}
