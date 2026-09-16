export const FREE_SHIPPING_THRESHOLD = 50;
export const STANDARD_SHIPPING_COST = 5.99;
export const EXPRESS_SHIPPING_COST = 14.99;
export const TAX_RATE = 0.05;

export interface OrderCoupon {
  type: "percentage" | "fixed" | "free-shipping";
  value: number;
}

/**
 * Mirrors fazar-mart/lib/pricing.ts exactly — totals are recomputed here
 * from the items/coupon the client sent rather than trusting a client-sent
 * total, so a tampered request body can't produce a cheaper order.
 */
export function calculateShipping(subtotal: number, method: "standard" | "express", coupon: OrderCoupon | null): number {
  if (subtotal === 0) return 0;
  if (coupon?.type === "free-shipping") return 0;
  if (method === "express") return EXPRESS_SHIPPING_COST;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_COST;
}

export function calculateDiscount(subtotal: number, coupon: OrderCoupon | null): number {
  if (!coupon) return 0;
  if (coupon.type === "percentage") return Math.round(subtotal * (coupon.value / 100) * 100) / 100;
  if (coupon.type === "fixed") return Math.min(coupon.value, subtotal);
  return 0;
}

export function calculateTax(taxableAmount: number): number {
  return Math.round(taxableAmount * TAX_RATE * 100) / 100;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
}

export function calculateOrderTotals(
  subtotal: number,
  method: "standard" | "express",
  coupon: OrderCoupon | null
): OrderTotals {
  const discount = calculateDiscount(subtotal, coupon);
  const shipping = calculateShipping(subtotal, method, coupon);
  const tax = calculateTax(Math.max(0, subtotal - discount));
  const total = Math.max(0, subtotal - discount) + shipping + tax;

  return { subtotal, discount, shipping, tax, total };
}
