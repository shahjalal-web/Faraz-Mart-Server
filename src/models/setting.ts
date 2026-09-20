import mongoose, { Schema } from "mongoose";

/**
 * One document per settings section ("store", "shipping", "tax", ...), value
 * kept as a free-form object. Defaults and validation live in
 * services/settings.ts, so adding a setting later never needs a migration.
 */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

export const Setting = mongoose.models.Setting ?? mongoose.model("Setting", settingSchema);
