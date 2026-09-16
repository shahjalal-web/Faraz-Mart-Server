import { Router } from "express";
import { connectToDatabase } from "../db";
import { Product, STOCK_STATUSES } from "../models/product";
import { Category } from "../models/category";
import { requireAdmin } from "../middleware/require-admin";
import { errorMessage } from "../utils/errors";

const router = Router();

const STRING_FIELDS = [
  "name",
  "slug",
  "sku",
  "categoryId",
  "brand",
  "shortDescription",
  "description",
  "thumbnail",
  "stockStatus",
  "seoTitle",
  "seoDescription",
] as const;
const NUMBER_FIELDS = ["price", "salePrice", "stock", "rating", "reviewCount", "soldCount"] as const;
const BOOLEAN_FIELDS = ["isFeatured", "isBestSeller", "isNewArrival", "isFlashSale"] as const;

function buildProductPayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const field of STRING_FIELDS) {
    if (typeof body[field] === "string" && body[field] !== "") payload[field] = body[field];
  }
  if (typeof body.subcategoryId === "string" && body.subcategoryId !== "") payload.subcategoryId = body.subcategoryId;
  else if (body.subcategoryId === null || body.subcategoryId === "") payload.subcategoryId = undefined;

  for (const field of NUMBER_FIELDS) {
    if (body[field] === "" || body[field] === null || body[field] === undefined) continue;
    const num = Number(body[field]);
    if (!Number.isNaN(num)) payload[field] = num;
  }
  if (body.salePrice === "" || body.salePrice === null) payload.salePrice = undefined;

  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] === "boolean") payload[field] = body[field];
  }

  if (Array.isArray(body.images)) payload.images = body.images.filter((v): v is string => typeof v === "string");
  if (Array.isArray(body.tags)) payload.tags = body.tags.filter((v): v is string => typeof v === "string");
  if (Array.isArray(body.colors)) payload.colors = body.colors;
  if (Array.isArray(body.sizes)) payload.sizes = body.sizes;

  if (typeof body.flashSaleEndsAt === "string" && body.flashSaleEndsAt !== "") {
    payload.flashSaleEndsAt = new Date(body.flashSaleEndsAt);
  } else if (body.flashSaleEndsAt === null || body.flashSaleEndsAt === "") {
    payload.flashSaleEndsAt = undefined;
  }

  if (payload.stockStatus && !STOCK_STATUSES.includes(payload.stockStatus as (typeof STOCK_STATUSES)[number])) {
    delete payload.stockStatus;
  }

  return payload;
}

/** Keeps Category.productCount (a denormalized counter) in sync on create/delete/move. */
async function adjustCategoryCounts(categoryIds: Array<string | undefined>, delta: number) {
  const ids = categoryIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  await Category.updateMany({ _id: { $in: ids } }, { $inc: { productCount: delta } });
}

router.get("/", async (_req, res) => {
  await connectToDatabase();
  const products = await Product.find().sort({ createdAt: -1 });
  res.json(products);
});

router.get("/:id", async (req, res) => {
  await connectToDatabase();
  const product = await Product.findById(req.params.id).catch(() => null);
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json(product);
});

router.post("/", requireAdmin(), async (req, res) => {
  await connectToDatabase();
  const payload = buildProductPayload(req.body ?? {});
  if (!payload.name || !payload.slug || !payload.sku || !payload.categoryId || !payload.thumbnail) {
    return res.status(400).json({ error: "Name, slug, SKU, category and thumbnail are required." });
  }

  try {
    const product = await Product.create(payload);
    await adjustCategoryCounts([String(product.categoryId), product.subcategoryId ? String(product.subcategoryId) : undefined], 1);
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.put("/:id", requireAdmin(), async (req, res) => {
  await connectToDatabase();
  const existing = await Product.findById(req.params.id).catch(() => null);
  if (!existing) return res.status(404).json({ error: "Product not found." });

  const previousCategoryId = String(existing.categoryId);
  const previousSubcategoryId = existing.subcategoryId ? String(existing.subcategoryId) : undefined;

  const payload = buildProductPayload(req.body ?? {});

  try {
    Object.assign(existing, payload);
    await existing.save();

    const nextCategoryId = String(existing.categoryId);
    const nextSubcategoryId = existing.subcategoryId ? String(existing.subcategoryId) : undefined;
    if (previousCategoryId !== nextCategoryId || previousSubcategoryId !== nextSubcategoryId) {
      await adjustCategoryCounts([previousCategoryId, previousSubcategoryId], -1);
      await adjustCategoryCounts([nextCategoryId, nextSubcategoryId], 1);
    }

    res.json(existing);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.delete("/:id", requireAdmin(), async (req, res) => {
  await connectToDatabase();
  const existing = await Product.findByIdAndDelete(req.params.id).catch(() => null);
  if (!existing) return res.status(404).json({ error: "Product not found." });

  await adjustCategoryCounts(
    [String(existing.categoryId), existing.subcategoryId ? String(existing.subcategoryId) : undefined],
    -1
  );
  res.json({ success: true });
});

export default router;
