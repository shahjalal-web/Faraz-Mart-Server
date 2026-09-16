/**
 * One-time migration: loads the current mock catalog from the frontend repo
 * (fazar-mart/data/{categories,products}.ts) and inserts it into MongoDB.
 * Run with: npm run migrate:catalog (from inside backend/)
 *
 * Safe to re-run: it deletes any existing Category/Product documents first,
 * so this is meant for the initial migration and for resetting to the mock
 * baseline in a fresh database — not for merging with data an admin has
 * already created through the dashboard.
 *
 * The cross-repo import below works because both source files only import
 * their type (`import type { Product } from "@/types/product"`), which is
 * erased at runtime — tsx never needs to resolve the "@/" alias.
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import mongoose from "mongoose";
import { connectToDatabase } from "../src/db";
import { Category } from "../src/models/category";
import { Product } from "../src/models/product";
import { categories as mockCategories } from "../../fazar-mart/data/categories";
import { products as mockProducts } from "../../fazar-mart/data/products";

async function main() {
  await connectToDatabase();

  await Product.deleteMany({});
  await Category.deleteMany({});

  // Pass 1: create every category with parentId left empty, so we have real
  // ObjectIds to map the mock's string ids ("cat-electronics") onto before
  // wiring up parent/child references in pass 2.
  const categoryIdMap = new Map<string, string>();
  for (const category of mockCategories) {
    const created = await Category.create({
      name: category.name,
      slug: category.slug,
      description: category.description,
      image: category.image,
      productCount: 0, // recomputed below from the actual migrated products
      isActive: category.isActive,
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
    });
    categoryIdMap.set(category.id, String(created._id));
  }

  for (const category of mockCategories) {
    if (!category.parentId) continue;
    const newId = categoryIdMap.get(category.id);
    const newParentId = categoryIdMap.get(category.parentId);
    if (newId && newParentId) {
      await Category.updateOne({ _id: newId }, { parentId: newParentId });
    }
  }

  let migratedProducts = 0;
  for (const product of mockProducts) {
    const categoryId = categoryIdMap.get(product.categoryId);
    if (!categoryId) {
      console.warn(`Skipping "${product.name}" — unknown categoryId ${product.categoryId}`);
      continue;
    }
    const subcategoryId = product.subcategoryId ? categoryIdMap.get(product.subcategoryId) : undefined;

    await Product.create({
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      categoryId,
      subcategoryId,
      brand: product.brand,
      shortDescription: product.shortDescription,
      description: product.description,
      images: product.images,
      thumbnail: product.thumbnail,
      price: product.price,
      salePrice: product.salePrice,
      stock: product.stock,
      stockStatus: product.stockStatus,
      rating: product.rating,
      reviewCount: product.reviewCount,
      soldCount: product.soldCount,
      tags: product.tags,
      colors: product.colors,
      sizes: product.sizes,
      isFeatured: product.isFeatured,
      isBestSeller: product.isBestSeller,
      isNewArrival: product.isNewArrival,
      isFlashSale: product.isFlashSale,
      flashSaleEndsAt: product.flashSaleEndsAt ? new Date(product.flashSaleEndsAt) : undefined,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      createdAt: new Date(product.createdAt),
    });
    migratedProducts += 1;

    await Category.updateOne({ _id: categoryId }, { $inc: { productCount: 1 } });
    if (subcategoryId) await Category.updateOne({ _id: subcategoryId }, { $inc: { productCount: 1 } });
  }

  console.log(`Migrated ${categoryIdMap.size} categories and ${migratedProducts} products.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
