import { Router } from "express";
import { connectToDatabase } from "../db";
import { Product } from "../models/product";
import { Category } from "../models/category";
import { StockMovement } from "../models/stock-movement";
import { requireAdmin } from "../middleware/require-admin";
import { errorMessage } from "../utils/errors";
import { deleteCloudinaryImage } from "../cloudinary";
import { decorateProduct, getActiveDiscounts } from "../services/pricing-engine";
import { computeStockStatus } from "../services/inventory";
import { getSettings } from "../services/settings";

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

  // Cloudinary public_ids: always set explicitly (including clearing to
  // undefined) rather than only-when-non-empty, so replacing an uploaded
  // photo with a different one — or with a plain URL that has no public_id
  // — doesn't leave a stale id pointing at an image that's no longer used.
  if ("thumbnailPublicId" in body) {
    payload.thumbnailPublicId = typeof body.thumbnailPublicId === "string" && body.thumbnailPublicId ? body.thumbnailPublicId : undefined;
  }
  if ("imagePublicIds" in body) {
    payload.imagePublicIds = Array.isArray(body.imagePublicIds)
      ? body.imagePublicIds.filter((v): v is string => typeof v === "string")
      : [];
  }

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

  return payload;
}

/** Keeps Category.productCount (a denormalized counter) in sync on create/delete/move. */
async function adjustCategoryCounts(categoryIds: Array<string | undefined>, delta: number) {
  const ids = categoryIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  await Category.updateMany({ _id: { $in: ids } }, { $inc: { productCount: delta } });
}

// Storefront reads get salePrice with any active Marketing > Discount already
// applied. Admin screens that EDIT a product pass ?raw=1 so they see (and save
// back) the product's own stored prices — otherwise editing a product while a
// discount is running would silently bake the discounted price into it.
router.get("/", async (req, res) => {
  await connectToDatabase();
  const products = await Product.find().sort({ createdAt: -1 });
  const json = products.map((product) => product.toJSON() as Record<string, unknown>);
  if (req.query.raw === "1") return res.json(json);

  const discounts = await getActiveDiscounts();
  res.json(json.map((product) => decorateProduct(product, discounts)));
});

router.get("/:id", async (req, res) => {
  await connectToDatabase();
  const product = await Product.findById(req.params.id).catch(() => null);
  if (!product) return res.status(404).json({ error: "Product not found." });

  const json = product.toJSON() as Record<string, unknown>;
  if (req.query.raw === "1") return res.json(json);
  res.json(decorateProduct(json, await getActiveDiscounts()));
});

/** Stock status is always derived from the stock level, never typed in by hand. */
async function withDerivedStockStatus(payload: Record<string, unknown>) {
  if (typeof payload.stock !== "number") return;
  const { store } = await getSettings();
  payload.stockStatus = computeStockStatus(payload.stock, store.lowStockThreshold);
}

router.post("/", requireAdmin("products.manage"), async (req, res) => {
  await connectToDatabase();
  const payload = buildProductPayload(req.body ?? {});
  await withDerivedStockStatus(payload);
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

/** Deletes any Cloudinary images that were replaced/removed by this update — never blocks the response on failure. */
async function cleanUpReplacedImages(previousPublicIds: string[], nextPublicIds: string[]) {
  const nextSet = new Set(nextPublicIds);
  const orphaned = previousPublicIds.filter((id) => id && !nextSet.has(id));
  await Promise.all(
    orphaned.map((id) => deleteCloudinaryImage(id).catch((error) => console.error(`Failed to delete Cloudinary image ${id}:`, error)))
  );
}

router.put("/:id", requireAdmin("products.manage"), async (req, res) => {
  await connectToDatabase();
  const existing = await Product.findById(req.params.id).catch(() => null);
  if (!existing) return res.status(404).json({ error: "Product not found." });

  const previousCategoryId = String(existing.categoryId);
  const previousSubcategoryId = existing.subcategoryId ? String(existing.subcategoryId) : undefined;
  const previousPublicIds = [existing.thumbnailPublicId, ...(existing.imagePublicIds ?? [])].filter(
    (id): id is string => Boolean(id)
  );

  const payload = buildProductPayload(req.body ?? {});
  await withDerivedStockStatus(payload);
  const previousStock = (existing.stock as number) ?? 0;

  try {
    Object.assign(existing, payload);
    await existing.save();

    if (typeof payload.stock === "number" && payload.stock !== previousStock) {
      await StockMovement.create({
        productId: existing._id,
        productName: existing.name,
        sku: existing.sku,
        delta: payload.stock - previousStock,
        before: previousStock,
        after: payload.stock,
        reason: "Edited in product form",
        actor: req.admin?.name ?? "",
      });
    }

    const nextCategoryId = String(existing.categoryId);
    const nextSubcategoryId = existing.subcategoryId ? String(existing.subcategoryId) : undefined;
    if (previousCategoryId !== nextCategoryId || previousSubcategoryId !== nextSubcategoryId) {
      await adjustCategoryCounts([previousCategoryId, previousSubcategoryId], -1);
      await adjustCategoryCounts([nextCategoryId, nextSubcategoryId], 1);
    }

    const nextPublicIds = [existing.thumbnailPublicId, ...(existing.imagePublicIds ?? [])].filter(
      (id): id is string => Boolean(id)
    );
    await cleanUpReplacedImages(previousPublicIds, nextPublicIds);

    res.json(existing);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.delete("/:id", requireAdmin("products.manage"), async (req, res) => {
  await connectToDatabase();
  const existing = await Product.findByIdAndDelete(req.params.id).catch(() => null);
  if (!existing) return res.status(404).json({ error: "Product not found." });

  await adjustCategoryCounts(
    [String(existing.categoryId), existing.subcategoryId ? String(existing.subcategoryId) : undefined],
    -1
  );

  const publicIds = [existing.thumbnailPublicId, ...(existing.imagePublicIds ?? [])].filter(
    (id): id is string => Boolean(id)
  );
  await Promise.all(
    publicIds.map((id) => deleteCloudinaryImage(id).catch((error) => console.error(`Failed to delete Cloudinary image ${id}:`, error)))
  );

  res.json({ success: true });
});

export default router;
