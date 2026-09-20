import { Product } from "../models/product";
import { Discount } from "../models/discount";
import { Promotion } from "../models/promotion";
import { Coupon } from "../models/coupon";
import { Customer } from "../models/customer";
import { connectToDatabase } from "../db";
import { getSettings, type AllSettings } from "./settings";
import { activeWindowFilter, round2 } from "../utils/active-window";
import { HttpError } from "../utils/errors";

/* ------------------------------------------------------------------ *
 * Product-level discounts (Marketing > Discounts)
 * ------------------------------------------------------------------ */

export interface ActiveDiscount {
  id: string;
  name: string;
  type: "percentage" | "fixed";
  value: number;
  scope: "all" | "categories" | "products" | "brands";
  targetIds: string[];
}

interface DiscountableProduct {
  id?: string;
  _id?: unknown;
  price: number;
  salePrice?: number | null;
  categoryId: unknown;
  subcategoryId?: unknown;
  brand: string;
}

export async function getActiveDiscounts(now = new Date()): Promise<ActiveDiscount[]> {
  await connectToDatabase();
  const docs = await Discount.find(activeWindowFilter("startsAt", "endsAt", now));
  return docs.map((doc) => ({
    id: doc.id as string,
    name: doc.name as string,
    type: doc.type as ActiveDiscount["type"],
    value: doc.value as number,
    scope: doc.scope as ActiveDiscount["scope"],
    targetIds: (doc.targetIds ?? []) as string[],
  }));
}

function productId(product: DiscountableProduct): string {
  return String(product.id ?? product._id);
}

function discountMatches(discount: ActiveDiscount, product: DiscountableProduct): boolean {
  switch (discount.scope) {
    case "all":
      return true;
    case "categories":
      return (
        discount.targetIds.includes(String(product.categoryId)) ||
        (product.subcategoryId != null && discount.targetIds.includes(String(product.subcategoryId)))
      );
    case "products":
      return discount.targetIds.includes(productId(product));
    case "brands":
      return discount.targetIds.some((brand) => brand.toLowerCase() === product.brand.toLowerCase());
  }
}

/**
 * The price a shopper actually pays: the product's own sale price, or the
 * best active discount applied to its regular price — whichever is lowest.
 * Discounts never stack with each other.
 */
export function effectivePrice(product: DiscountableProduct, discounts: ActiveDiscount[]): { price: number; discountName?: string } {
  let best = product.salePrice ?? product.price;
  let discountName: string | undefined;

  for (const discount of discounts) {
    if (!discountMatches(discount, product)) continue;
    const reduced = discount.type === "percentage" ? product.price * (1 - discount.value / 100) : product.price - discount.value;
    const candidate = Math.max(0, round2(reduced));
    if (candidate < best) {
      best = candidate;
      discountName = discount.name;
    }
  }

  return { price: best, discountName };
}

/** Product JSON as the storefront should see it: salePrice reflects any active discount. */
export function decorateProduct(json: Record<string, unknown>, discounts: ActiveDiscount[]): Record<string, unknown> {
  if (discounts.length === 0) return json;
  const product = json as unknown as DiscountableProduct;
  const { price, discountName } = effectivePrice(product, discounts);
  if (!discountName) return json;
  return { ...json, salePrice: price, activeDiscount: discountName };
}

/* ------------------------------------------------------------------ *
 * Cart quote: subtotal → promotions → coupon → shipping → tax → total
 * ------------------------------------------------------------------ */

export interface QuoteInput {
  items: unknown;
  deliveryMethod?: unknown;
  couponCode?: unknown;
  customerId?: string | null;
}

export interface QuoteLine {
  productId: string;
  name: string;
  slug: string;
  thumbnail: string;
  categoryId: string;
  price: number;
  originalPrice: number;
  quantity: number;
  color?: string;
  size?: string;
}

export interface Quote {
  lines: QuoteLine[];
  deliveryMethod: "standard" | "express";
  subtotal: number;
  promotionDiscount: number;
  couponDiscount: number;
  /** promotionDiscount + couponDiscount */
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  appliedCoupon: { code: string; type: "percentage" | "fixed" | "free-shipping"; value: number; description: string } | null;
  /** Why a supplied coupon code wasn't applied (invalid, expired, minimum not met...). */
  couponError: string | null;
  appliedPromotions: { id: string; name: string; amount: number; freeShipping: boolean }[];
  /** Cart lines that can't be fulfilled right now ("Only 2 left of X"). */
  stockIssues: string[];
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function calculateShipping(subtotal: number, method: "standard" | "express", freeShipping: boolean, settings: AllSettings["shipping"]) {
  if (subtotal === 0 || freeShipping) return 0;
  if (method === "express") return settings.expressCost;
  // A threshold of 0 (or less) means "no free-shipping threshold".
  const qualifiesForFree = settings.freeShippingThreshold > 0 && subtotal >= settings.freeShippingThreshold;
  return qualifiesForFree ? 0 : settings.standardCost;
}

export async function priceCart(input: QuoteInput): Promise<Quote> {
  await connectToDatabase();
  const settings = await getSettings();

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new HttpError(400, "Your cart is empty.");
  }

  const deliveryMethod = input.deliveryMethod === "express" ? "express" : "standard";
  if (deliveryMethod === "express" && !settings.shipping.expressEnabled) {
    throw new HttpError(400, "Express delivery isn't available right now.");
  }

  const discounts = await getActiveDiscounts();
  const lines: QuoteLine[] = [];
  const unitsByProduct = new Map<string, { name: string; stock: number; units: number }>();

  for (const raw of input.items as Record<string, unknown>[]) {
    const product = await Product.findById(raw?.productId).catch(() => null);
    if (!product) {
      throw new HttpError(400, `Product ${String(raw?.productId ?? "")} is no longer available.`);
    }

    const quantityNumber = Number(raw.quantity);
    const quantity = Number.isFinite(quantityNumber) && quantityNumber > 0 ? Math.floor(quantityNumber) : 1;
    const { price } = effectivePrice(product.toObject() as unknown as DiscountableProduct, discounts);

    lines.push({
      productId: String(product._id),
      name: product.name,
      slug: product.slug,
      thumbnail: product.thumbnail,
      categoryId: String(product.categoryId),
      price,
      originalPrice: product.price,
      quantity,
      color: typeof raw.color === "string" ? raw.color : undefined,
      size: typeof raw.size === "string" ? raw.size : undefined,
    });

    const tally = unitsByProduct.get(String(product._id)) ?? { name: product.name as string, stock: (product.stock as number) ?? 0, units: 0 };
    tally.units += quantity;
    unitsByProduct.set(String(product._id), tally);
  }

  const stockIssues: string[] = [];
  for (const { name, stock, units } of unitsByProduct.values()) {
    if (stock <= 0) stockIssues.push(`${name} is out of stock.`);
    else if (units > stock) stockIssues.push(`Only ${stock} left of ${name}.`);
  }

  const subtotal = round2(lines.reduce((sum, line) => sum + line.price * line.quantity, 0));

  /* ---- Automatic promotions ---- */
  let customerGroupId: string | null = null;
  if (input.customerId) {
    const customer = await Customer.findById(input.customerId).select("groupId").catch(() => null);
    customerGroupId = customer?.groupId ? String(customer.groupId) : null;
  }

  const promotions = await Promotion.find(activeWindowFilter());
  let bestPromotion: { id: string; name: string; amount: number } | null = null;
  const freeShippingPromotions: { id: string; name: string }[] = [];

  for (const promotion of promotions) {
    if (subtotal < ((promotion.minSubtotal as number) ?? 0)) continue;
    const groupIds = (promotion.customerGroupIds ?? []) as string[];
    if (groupIds.length > 0 && (!customerGroupId || !groupIds.includes(customerGroupId))) continue;

    if (promotion.type === "free-shipping") {
      freeShippingPromotions.push({ id: promotion.id as string, name: promotion.name as string });
      continue;
    }

    const value = (promotion.value as number) ?? 0;
    const amount = promotion.type === "percentage" ? round2(subtotal * (value / 100)) : Math.min(value, subtotal);
    if (amount > 0 && (!bestPromotion || amount > bestPromotion.amount)) {
      bestPromotion = { id: promotion.id as string, name: promotion.name as string, amount };
    }
  }

  const promotionDiscount = bestPromotion?.amount ?? 0;

  /* ---- Coupon code ---- */
  const code = typeof input.couponCode === "string" ? input.couponCode.trim().toUpperCase() : "";
  let appliedCoupon: Quote["appliedCoupon"] = null;
  let couponError: string | null = null;
  let couponDiscount = 0;
  let couponFreeShipping = false;

  if (code) {
    const coupon = await Coupon.findOne({ code });
    const now = new Date();

    if (!coupon || !coupon.isActive) couponError = "Invalid or expired coupon code.";
    else if (coupon.startsAt && coupon.startsAt > now) couponError = "This coupon isn't active yet.";
    else if (coupon.expiresAt && coupon.expiresAt < now) couponError = "This coupon has expired.";
    else if (coupon.usageLimit && (coupon.usedCount as number) >= (coupon.usageLimit as number)) couponError = "This coupon has reached its usage limit.";
    else if (coupon.minOrderAmount && subtotal < (coupon.minOrderAmount as number)) {
      couponError = `Spend ${formatMoney(coupon.minOrderAmount as number, settings.store.currency)} or more to use this coupon.`;
    } else {
      const base = Math.max(0, subtotal - promotionDiscount);
      const value = (coupon.value as number) ?? 0;

      if (coupon.type === "percentage") {
        couponDiscount = round2(base * (value / 100));
        if (coupon.maxDiscountAmount) couponDiscount = Math.min(couponDiscount, coupon.maxDiscountAmount as number);
      } else if (coupon.type === "fixed") {
        couponDiscount = Math.min(value, base);
      } else {
        couponFreeShipping = true;
      }

      appliedCoupon = {
        code: coupon.code as string,
        type: coupon.type as "percentage" | "fixed" | "free-shipping",
        value,
        description: (coupon.description as string) ?? "",
      };
    }
  }

  const discount = round2(promotionDiscount + couponDiscount);
  const discountedSubtotal = Math.max(0, subtotal - discount);
  const shipping = round2(calculateShipping(subtotal, deliveryMethod, couponFreeShipping || freeShippingPromotions.length > 0, settings.shipping));
  const tax = settings.tax.enabled ? round2(discountedSubtotal * (settings.tax.ratePercent / 100)) : 0;
  const total = round2(discountedSubtotal + shipping + tax);

  return {
    lines,
    deliveryMethod,
    subtotal,
    promotionDiscount: round2(promotionDiscount),
    couponDiscount: round2(couponDiscount),
    discount,
    shipping,
    tax,
    total,
    appliedCoupon,
    couponError,
    appliedPromotions: [
      ...(bestPromotion ? [{ id: bestPromotion.id, name: bestPromotion.name, amount: bestPromotion.amount, freeShipping: false }] : []),
      ...freeShippingPromotions.map((promotion) => ({ ...promotion, amount: 0, freeShipping: true })),
    ],
    stockIssues,
  };
}
