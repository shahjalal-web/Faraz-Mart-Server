import { Coupon, COUPON_TYPES } from "../models/coupon";
import { Discount, DISCOUNT_SCOPES, DISCOUNT_TYPES } from "../models/discount";
import { Promotion, PROMOTION_TYPES } from "../models/promotion";
import { Campaign, CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES } from "../models/campaign";
import { Banner, BANNER_PLACEMENTS } from "../models/banner";
import { Order } from "../models/order";
import { activeWindowFilter } from "../utils/active-window";
import { createCrudRouter } from "../utils/crud";
import { HttpError } from "../utils/errors";

function oneOf(value: unknown, allowed: readonly string[], label: string) {
  if (value !== undefined && !allowed.includes(value as string)) {
    throw new HttpError(400, `${label} must be one of: ${allowed.join(", ")}.`);
  }
}

function assertWindow(start: unknown, end: unknown, endLabel: string) {
  if (start instanceof Date && end instanceof Date && end < start) {
    throw new HttpError(400, `${endLabel} must be after the start date.`);
  }
}

/* -------------------------------- Coupons -------------------------------- */

export const couponsRouter = createCrudRouter({
  model: Coupon,
  resource: "coupons",
  fields: {
    code: "string",
    description: "string",
    type: "string",
    value: "number",
    minOrderAmount: "number",
    maxDiscountAmount: "number",
    usageLimit: "number",
    startsAt: "date",
    expiresAt: "date",
    isActive: "boolean",
  },
  required: ["code", "type"],
  beforeSave: (payload, existing) => {
    oneOf(payload.type, COUPON_TYPES, "Type");
    if (typeof payload.code === "string") payload.code = payload.code.toUpperCase().replace(/\s+/g, "");
    if (payload.code !== undefined && !/^[A-Z0-9_-]{3,32}$/.test(payload.code as string)) {
      throw new HttpError(400, "Code must be 3–32 letters, numbers, dashes or underscores.");
    }

    const type = (payload.type ?? existing?.type) as string | undefined;
    const value = (payload.value ?? existing?.value) as number | undefined;
    if (type === "percentage" && (!value || value <= 0 || value > 100)) throw new HttpError(400, "A percentage coupon needs a value between 1 and 100.");
    if (type === "fixed" && (!value || value <= 0)) throw new HttpError(400, "A fixed coupon needs a value above 0.");
    if (type === "free-shipping") payload.value = 0;

    assertWindow(payload.startsAt, payload.expiresAt, "Expiry date");
  },
});

/* ------------------------------- Discounts ------------------------------- */

export const discountsRouter = createCrudRouter({
  model: Discount,
  resource: "discounts",
  fields: {
    name: "string",
    description: "string",
    type: "string",
    value: "number",
    scope: "string",
    targetIds: "stringArray",
    startsAt: "date",
    endsAt: "date",
    isActive: "boolean",
  },
  required: ["name", "type", "value"],
  beforeSave: (payload, existing) => {
    oneOf(payload.type, DISCOUNT_TYPES, "Type");
    oneOf(payload.scope, DISCOUNT_SCOPES, "Scope");

    const type = (payload.type ?? existing?.type) as string | undefined;
    const value = (payload.value ?? existing?.value) as number | undefined;
    if (value === undefined || value <= 0) throw new HttpError(400, "Value must be above 0.");
    if (type === "percentage" && value > 100) throw new HttpError(400, "A percentage discount can't be more than 100.");

    const scope = (payload.scope ?? existing?.scope ?? "all") as string;
    const targets = (payload.targetIds ?? existing?.targetIds ?? []) as string[];
    const noun = { categories: "category", products: "product", brands: "brand" }[scope as "categories" | "products" | "brands"];
    if (scope !== "all" && targets.length === 0) throw new HttpError(400, `Pick at least one ${noun} for this discount to apply to.`);
    if (scope === "all") payload.targetIds = [];

    assertWindow(payload.startsAt, payload.endsAt, "End date");
  },
});

/* ------------------------------ Promotions ------------------------------ */

export const promotionsRouter = createCrudRouter({
  model: Promotion,
  resource: "promotions",
  fields: {
    name: "string",
    description: "string",
    type: "string",
    value: "number",
    minSubtotal: "number",
    customerGroupIds: "stringArray",
    startsAt: "date",
    endsAt: "date",
    isActive: "boolean",
  },
  required: ["name", "type"],
  beforeSave: (payload, existing) => {
    oneOf(payload.type, PROMOTION_TYPES, "Type");

    const type = (payload.type ?? existing?.type) as string | undefined;
    const value = (payload.value ?? existing?.value) as number | undefined;
    if (type === "percentage" && (!value || value <= 0 || value > 100)) throw new HttpError(400, "A percentage promotion needs a value between 1 and 100.");
    if (type === "fixed" && (!value || value <= 0)) throw new HttpError(400, "A fixed promotion needs a value above 0.");
    if (type === "free-shipping") payload.value = 0;

    assertWindow(payload.startsAt, payload.endsAt, "End date");
  },
});

/* ------------------------------- Campaigns ------------------------------- */

export const campaignsRouter = createCrudRouter({
  model: Campaign,
  resource: "campaigns",
  fields: {
    name: "string",
    description: "string",
    channel: "string",
    status: "string",
    startsAt: "date",
    endsAt: "date",
    budget: "number",
    couponCode: "string",
    notes: "string",
  },
  required: ["name"],
  beforeSave: (payload) => {
    oneOf(payload.channel, CAMPAIGN_CHANNELS, "Channel");
    oneOf(payload.status, CAMPAIGN_STATUSES, "Status");
    if (typeof payload.couponCode === "string") payload.couponCode = payload.couponCode.toUpperCase();
    assertWindow(payload.startsAt, payload.endsAt, "End date");
  },

  // Performance is measured by orders that used the campaign's coupon code
  // during its run (cancelled / returned / refunded orders don't count).
  decorateList: async (items) =>
    Promise.all(
      items.map(async (item) => {
        const code = item.couponCode as string | undefined;
        if (!code) return { ...item, orders: 0, revenue: 0 };

        const createdAt: Record<string, Date> = {};
        if (item.startsAt) createdAt.$gte = new Date(item.startsAt as string);
        if (item.endsAt) createdAt.$lte = new Date(item.endsAt as string);

        const [result] = await Order.aggregate([
          {
            $match: {
              couponCode: code,
              status: { $nin: ["cancelled", "returned", "refunded"] },
              ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
            },
          },
          { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
        ]);
        return { ...item, orders: result?.orders ?? 0, revenue: Math.round((result?.revenue ?? 0) * 100) / 100 };
      })
    ),
});

/* -------------------------------- Banners -------------------------------- */

export const bannersRouter = createCrudRouter({
  model: Banner,
  resource: "banners",
  fields: {
    placement: "string",
    eyebrow: "string",
    title: "string",
    highlight: "string",
    description: "string",
    ctaLabel: "string",
    ctaHref: "string",
    secondaryCtaLabel: "string",
    secondaryCtaHref: "string",
    gradient: "string",
    image: "string",
    imagePublicId: "string",
    sortOrder: "number",
    startsAt: "date",
    endsAt: "date",
    isActive: "boolean",
  },
  required: ["title"],
  sort: { sortOrder: 1, createdAt: 1 },
  publicFilter: () => activeWindowFilter(),
  queryFilters: ["placement"],
  cloudinaryFields: ["imagePublicId"],
  beforeSave: (payload) => {
    oneOf(payload.placement, BANNER_PLACEMENTS, "Placement");
    assertWindow(payload.startsAt, payload.endsAt, "End date");
  },
});
