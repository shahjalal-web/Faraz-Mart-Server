import type { Schema } from "mongoose";

/**
 * Every model uses this so API responses expose `id` (matching the
 * frontend's TypeScript types) instead of Mongoose's `_id`/`__v`.
 */
export function applyIdTransform(schema: Schema): void {
  schema.set("toJSON", {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
    },
  });
}
