import { Product } from "../models/product";
import { StockMovement } from "../models/stock-movement";
import { getSettings } from "./settings";

export type StockStatus = "in-stock" | "low-stock" | "out-of-stock";

export function computeStockStatus(stock: number, lowStockThreshold: number): StockStatus {
  if (stock <= 0) return "out-of-stock";
  if (stock <= lowStockThreshold) return "low-stock";
  return "in-stock";
}

interface AdjustOptions {
  reason: string;
  /** Who/what caused it — an admin's name, or e.g. "Order FM-123456". */
  actor: string;
  /** Also move the product's soldCount by this much (orders add, cancellations subtract). */
  soldDelta?: number;
}

/**
 * Atomically changes a product's stock by `delta`. Decrements only succeed
 * while enough stock is left (the `$gte` guard is part of the same atomic
 * update, so two simultaneous orders can't both take the last unit) and the
 * function returns null when they don't. Every successful change is logged
 * to StockMovement and the product's stockStatus is re-derived from the
 * new level.
 */
export async function adjustStock(productId: string, delta: number, options: AdjustOptions) {
  const filter = delta < 0 ? { _id: productId, stock: { $gte: -delta } } : { _id: productId };
  const update: Record<string, unknown> = { $inc: { stock: delta, ...(options.soldDelta ? { soldCount: options.soldDelta } : {}) } };

  const before = await Product.findOneAndUpdate(filter, update, { returnDocument: "before" });
  if (!before) return null;

  const previous = (before.stock as number) ?? 0;
  const next = previous + delta;
  const { store } = await getSettings();

  await Product.updateOne({ _id: productId }, { stockStatus: computeStockStatus(next, store.lowStockThreshold) });
  await StockMovement.create({
    productId,
    productName: before.name,
    sku: before.sku,
    delta,
    before: previous,
    after: next,
    reason: options.reason,
    actor: options.actor,
  });

  return { before: previous, after: next };
}
