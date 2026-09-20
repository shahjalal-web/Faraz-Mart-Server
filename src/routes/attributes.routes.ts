import { Attribute, ATTRIBUTE_TYPES } from "../models/attribute";
import { createCrudRouter } from "../utils/crud";
import { HttpError } from "../utils/errors";
import { slugify } from "../utils/slug";

/** Cleans the submitted value list: trims, drops blanks, fills `value` from the label, keeps hex only when valid. */
function normaliseValues(raw: unknown): { label: string; value: string; hex?: string }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const values: { label: string; value: string; hex?: string }[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { label, value, hex } = entry as Record<string, unknown>;
    if (typeof label !== "string" || !label.trim()) continue;

    const cleanLabel = label.trim();
    const cleanValue = typeof value === "string" && value.trim() ? value.trim() : slugify(cleanLabel);
    if (seen.has(cleanValue)) throw new HttpError(400, `"${cleanLabel}" is listed twice.`);
    seen.add(cleanValue);

    const cleanHex = typeof hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(hex.trim()) ? hex.trim() : undefined;
    values.push({ label: cleanLabel, value: cleanValue, ...(cleanHex ? { hex: cleanHex } : {}) });
  }

  return values;
}

export default createCrudRouter({
  model: Attribute,
  resource: "attributes",
  fields: { name: "string", slug: "string", type: "string", values: "json", isActive: "boolean" },
  required: ["name", "slug"],
  sort: { name: 1 },
  publicFilter: () => ({ isActive: true }),
  lookupField: "slug",
  beforeSave: (payload) => {
    if ("values" in payload) payload.values = normaliseValues(payload.values);
    if (payload.type !== undefined && !(ATTRIBUTE_TYPES as readonly string[]).includes(payload.type as string)) {
      throw new HttpError(400, "Type must be color, size or text.");
    }
  },
});
