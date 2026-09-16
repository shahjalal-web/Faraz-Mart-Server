import { Router } from "express";
import { connectToDatabase } from "../db";
import { Category } from "../models/category";
import { Product } from "../models/product";
import { requireAdmin } from "../middleware/require-admin";
import { errorMessage } from "../utils/errors";

const router = Router();

const STRING_FIELDS = ["name", "slug", "description", "image", "seoTitle", "seoDescription"] as const;

function buildCategoryPayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const field of STRING_FIELDS) {
    if (typeof body[field] === "string") payload[field] = body[field];
  }
  if (body.parentId === null || body.parentId === "") payload.parentId = null;
  else if (typeof body.parentId === "string") payload.parentId = body.parentId;
  if (typeof body.isActive === "boolean") payload.isActive = body.isActive;

  return payload;
}

router.get("/", async (_req, res) => {
  await connectToDatabase();
  const categories = await Category.find().sort({ name: 1 });
  res.json(categories);
});

router.get("/:id", async (req, res) => {
  await connectToDatabase();
  const category = await Category.findById(req.params.id).catch(() => null);
  if (!category) return res.status(404).json({ error: "Category not found." });
  res.json(category);
});

router.post("/", requireAdmin(), async (req, res) => {
  await connectToDatabase();
  const payload = buildCategoryPayload(req.body ?? {});
  if (!payload.name || !payload.slug) {
    return res.status(400).json({ error: "Name and slug are required." });
  }

  try {
    const category = await Category.create(payload);
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.put("/:id", requireAdmin(), async (req, res) => {
  await connectToDatabase();
  const existing = await Category.findById(req.params.id).catch(() => null);
  if (!existing) return res.status(404).json({ error: "Category not found." });

  const payload = buildCategoryPayload(req.body ?? {});
  if (payload.parentId === req.params.id) {
    return res.status(400).json({ error: "A category cannot be its own parent." });
  }

  if (payload.parentId) {
    const hasChildren = await Category.exists({ parentId: existing._id });
    if (hasChildren) {
      return res.status(400).json({
        error: "This category has subcategories under it, so it can't also become a subcategory itself.",
      });
    }
  }

  try {
    Object.assign(existing, payload);
    await existing.save();
    res.json(existing);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.delete("/:id", requireAdmin(), async (req, res) => {
  await connectToDatabase();
  const existing = await Category.findById(req.params.id).catch(() => null);
  if (!existing) return res.status(404).json({ error: "Category not found." });

  const [productCount, subcategoryCount] = await Promise.all([
    Product.countDocuments({ $or: [{ categoryId: existing._id }, { subcategoryId: existing._id }] }),
    Category.countDocuments({ parentId: existing._id }),
  ]);

  if (productCount > 0 || subcategoryCount > 0) {
    return res.status(400).json({
      error: "This category still has products or subcategories under it — move or remove those first.",
    });
  }

  await existing.deleteOne();
  res.json({ success: true });
});

export default router;
