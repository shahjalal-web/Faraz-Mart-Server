import { Router } from "express";
import mongoose from "mongoose";
import { connectToDatabase } from "../db";
import { Product } from "../models/product";
import { StockMovement } from "../models/stock-movement";
import { requireAdmin } from "../middleware/require-admin";
import { adjustStock } from "../services/inventory";
import { getSettings } from "../services/settings";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";

const router = Router();

router.get("/", requireAdmin("inventory.view"), async (_req, res) => {
  try {
    await connectToDatabase();
    const [products, settings] = await Promise.all([
      Product.find().sort({ name: 1 }).select("name sku thumbnail brand price salePrice stock stockStatus categoryId"),
      getSettings(),
    ]);

    const items = products.map((product) => ({
      id: product.id as string,
      name: product.name as string,
      sku: product.sku as string,
      thumbnail: product.thumbnail as string,
      brand: product.brand as string,
      price: product.price as number,
      stock: (product.stock as number) ?? 0,
      stockStatus: product.stockStatus as string,
    }));

    res.json({
      lowStockThreshold: settings.store.lowStockThreshold,
      summary: {
        products: items.length,
        totalUnits: items.reduce((sum, item) => sum + item.stock, 0),
        inStock: items.filter((item) => item.stockStatus === "in-stock").length,
        lowStock: items.filter((item) => item.stockStatus === "low-stock").length,
        outOfStock: items.filter((item) => item.stockStatus === "out-of-stock").length,
        stockValue: Math.round(items.reduce((sum, item) => sum + item.stock * item.price, 0) * 100) / 100,
      },
      items,
    });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/movements", requireAdmin("inventory.view"), async (req, res) => {
  try {
    await connectToDatabase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const productId = typeof req.query.productId === "string" && mongoose.isValidObjectId(req.query.productId) ? req.query.productId : undefined;
    const movements = await StockMovement.find(productId ? { productId } : {})
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json(movements);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/**
 * Body: { mode: "set" | "add", quantity: number, reason?: string }.
 * "set" makes the stock exactly `quantity` (a stock-take); "add" adds
 * `quantity` (negative to remove — e.g. damaged goods).
 */
router.post("/:productId/adjust", requireAdmin("inventory.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const product = await Product.findById(req.params.productId).catch(() => null);
    if (!product) return res.status(404).json({ error: "Product not found." });

    const mode = req.body?.mode === "add" ? "add" : "set";
    const quantity = Math.trunc(Number(req.body?.quantity));
    if (!Number.isFinite(quantity)) throw new HttpError(400, "Enter a whole number.");

    const current = (product.stock as number) ?? 0;
    const target = mode === "set" ? quantity : current + quantity;
    if (target < 0) throw new HttpError(400, "Stock can't go below zero.");

    const delta = target - current;
    if (delta === 0) return res.json({ before: current, after: current });

    const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : mode === "set" ? "Stock count" : "Manual adjustment";
    const result = await adjustStock(product.id as string, delta, { reason, actor: req.admin?.name ?? "" });
    if (!result) throw new HttpError(409, "Stock changed while you were editing — refresh and try again.");

    res.json(result);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
