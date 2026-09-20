import { connectToDatabase } from "../db";
import { Setting } from "../models/setting";

export type SettingsSection = "store" | "payment" | "shipping" | "tax" | "notifications" | "security";

export const SETTINGS_SECTIONS: SettingsSection[] = ["store", "payment", "shipping", "tax", "notifications", "security"];

/** Every setting's default doubles as its type definition — see coerceSection(). */
export const SETTINGS_DEFAULTS = {
  store: {
    name: "Faraz Mart",
    tagline: "Shop everything you love",
    email: "support@farazmart.com",
    phone: "+1 (800) 555-1234",
    address: "42 Dawn Avenue, Suite 100, New York",
    currency: "USD",
    facebookUrl: "",
    instagramUrl: "",
    twitterUrl: "",
    youtubeUrl: "",
    lowStockThreshold: 10,
    autoApproveReviews: false,
  },
  payment: {
    cardEnabled: true,
    cardLabel: "Credit / Debit Card",
    cardDescription: "Visa, Mastercard, Amex",
    codEnabled: true,
    codLabel: "Cash on Delivery",
    codDescription: "Pay when your order arrives",
    mobileBankingEnabled: true,
    mobileBankingLabel: "Mobile Banking",
    mobileBankingDescription: "bKash, Nagad and more",
  },
  shipping: {
    standardCost: 5.99,
    expressCost: 14.99,
    freeShippingThreshold: 50,
    standardEta: "3–5 business days",
    expressEta: "1–2 business days",
    expressEnabled: true,
  },
  tax: {
    enabled: true,
    ratePercent: 5,
    label: "Tax",
  },
  notifications: {
    adminEmail: "",
    newOrder: true,
    lowStock: true,
    newReview: true,
    newCustomer: false,
  },
  security: {
    adminSessionDays: 7,
    minPasswordLength: 6,
    allowCustomerRegistration: true,
  },
};

export type AllSettings = typeof SETTINGS_DEFAULTS;

const CACHE_TTL_MS = 5000;
let cache: { at: number; value: AllSettings } | null = null;

export function clearSettingsCache() {
  cache = null;
}

/** Keeps only known keys, coerced to the type of their default — unknown keys and wrong types are dropped. */
export function coerceSection<S extends SettingsSection>(section: S, input: Record<string, unknown>): Partial<AllSettings[S]> {
  const defaults = SETTINGS_DEFAULTS[section] as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const key of Object.keys(defaults)) {
    if (!(key in input)) continue;
    const raw = input[key];
    const expected = typeof defaults[key];

    if (expected === "boolean" && typeof raw === "boolean") output[key] = raw;
    else if (expected === "number") {
      const num = typeof raw === "string" && raw.trim() === "" ? NaN : Number(raw);
      if (Number.isFinite(num)) output[key] = num;
    } else if (expected === "string" && typeof raw === "string") output[key] = raw.trim();
  }

  return output as Partial<AllSettings[S]>;
}

export async function getSettings(): Promise<AllSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  await connectToDatabase();
  const docs = await Setting.find({ key: { $in: SETTINGS_SECTIONS } });
  const stored = new Map<string, Record<string, unknown>>(docs.map((doc) => [doc.key as string, (doc.value ?? {}) as Record<string, unknown>]));

  const merged = {} as Record<string, unknown>;
  for (const section of SETTINGS_SECTIONS) {
    merged[section] = { ...SETTINGS_DEFAULTS[section], ...coerceSection(section, stored.get(section) ?? {}) };
  }

  cache = { at: Date.now(), value: merged as AllSettings };
  return cache.value;
}

export async function saveSettingsSection<S extends SettingsSection>(section: S, input: Record<string, unknown>) {
  await connectToDatabase();
  const current = (await getSettings())[section];
  const next = { ...current, ...coerceSection(section, input) };
  await Setting.findOneAndUpdate({ key: section }, { key: section, value: next }, { upsert: true, returnDocument: "after" });
  clearSettingsCache();
  return next;
}

/** The subset of settings the storefront (and anonymous visitors) may see. */
export function toPublicSettings(settings: AllSettings) {
  const { store, payment, shipping, tax, security } = settings;

  const paymentMethods = [
    { value: "card", enabled: payment.cardEnabled, label: payment.cardLabel, description: payment.cardDescription },
    { value: "cod", enabled: payment.codEnabled, label: payment.codLabel, description: payment.codDescription },
    {
      value: "mobile-banking",
      enabled: payment.mobileBankingEnabled,
      label: payment.mobileBankingLabel,
      description: payment.mobileBankingDescription,
    },
  ]
    .filter((method) => method.enabled)
    .map(({ value, label, description }) => ({ value, label, description }));

  return {
    store: {
      name: store.name,
      tagline: store.tagline,
      email: store.email,
      phone: store.phone,
      address: store.address,
      currency: store.currency,
      facebookUrl: store.facebookUrl,
      instagramUrl: store.instagramUrl,
      twitterUrl: store.twitterUrl,
      youtubeUrl: store.youtubeUrl,
    },
    paymentMethods,
    shipping: { ...shipping },
    tax: { ...tax },
    security: { allowCustomerRegistration: security.allowCustomerRegistration, minPasswordLength: security.minPasswordLength },
  };
}

export type PublicSettings = ReturnType<typeof toPublicSettings>;
