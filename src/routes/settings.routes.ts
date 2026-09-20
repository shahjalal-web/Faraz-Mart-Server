import { Router } from "express";
import { requireAdmin } from "../middleware/require-admin";
import {
  getSettings,
  saveSettingsSection,
  SETTINGS_SECTIONS,
  toPublicSettings,
  type SettingsSection,
} from "../services/settings";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";

const router = Router();

// Public: what the storefront needs (store name/contact, enabled payment
// methods, shipping and tax rules). Nothing private is exposed here.
router.get("/public", async (_req, res) => {
  try {
    res.json(toPublicSettings(await getSettings()));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/", requireAdmin("settings.view"), async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/** Rules the numbers must satisfy — checked after coercion, before saving. */
function validateSection(section: SettingsSection, values: Record<string, unknown>) {
  const num = (key: string) => values[key] as number | undefined;

  if (section === "shipping") {
    for (const key of ["standardCost", "expressCost", "freeShippingThreshold"]) {
      if (num(key) !== undefined && num(key)! < 0) throw new HttpError(400, "Shipping amounts can't be negative.");
    }
  }
  if (section === "tax" && num("ratePercent") !== undefined && (num("ratePercent")! < 0 || num("ratePercent")! > 100)) {
    throw new HttpError(400, "Tax rate must be between 0 and 100.");
  }
  if (section === "store" && num("lowStockThreshold") !== undefined && num("lowStockThreshold")! < 0) {
    throw new HttpError(400, "Low-stock threshold can't be negative.");
  }
  if (section === "security") {
    if (num("adminSessionDays") !== undefined && (num("adminSessionDays")! < 1 || num("adminSessionDays")! > 90)) {
      throw new HttpError(400, "Admin session length must be between 1 and 90 days.");
    }
    if (num("minPasswordLength") !== undefined && (num("minPasswordLength")! < 6 || num("minPasswordLength")! > 64)) {
      throw new HttpError(400, "Minimum password length must be between 6 and 64 (Firebase needs at least 6).");
    }
  }
  if (section === "payment") {
    const enabled = [values.cardEnabled, values.codEnabled, values.mobileBankingEnabled];
    if (enabled.every((flag) => flag === false)) throw new HttpError(400, "Keep at least one payment method enabled, or nobody can check out.");
  }
}

router.put("/:section", requireAdmin("settings.manage"), async (req, res) => {
  try {
    const section = req.params.section as SettingsSection;
    if (!SETTINGS_SECTIONS.includes(section)) return res.status(404).json({ error: "Unknown settings section." });

    const body = (req.body ?? {}) as Record<string, unknown>;

    // Validate the merged result, so e.g. turning off one payment method is judged against the others' saved state.
    const current = (await getSettings())[section] as Record<string, unknown>;
    validateSection(section, { ...current, ...body });

    res.json(await saveSettingsSection(section, body));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
