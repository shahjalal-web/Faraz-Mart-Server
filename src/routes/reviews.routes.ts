import { Router } from "express";
import mongoose from "mongoose";
import { connectToDatabase } from "../db";
import { Review, REVIEW_STATUSES } from "../models/review";
import { Product } from "../models/product";
import { Order } from "../models/order";
import { requireAdmin } from "../middleware/require-admin";
import { requireCustomer } from "../middleware/require-customer";
import { getSettings } from "../services/settings";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";

const router = Router();

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** What the storefront may see of a review — no customer id, moderation note or status. */
function publicReview(doc: InstanceType<typeof Review>) {
  return {
    id: doc.id as string,
    productId: doc.productId ? String(doc.productId) : undefined,
    customerName: doc.customerName as string,
    avatar: initials(doc.customerName as string),
    rating: doc.rating as number,
    title: (doc.title as string) || undefined,
    comment: doc.comment as string,
    isVerifiedPurchase: doc.isVerifiedPurchase as boolean,
    date: (doc.createdAt as Date).toISOString(),
  };
}

/** Keeps Product.rating / reviewCount in step with the approved reviews, so product cards show real numbers. */
async function recomputeProductRating(productId: unknown) {
  if (!productId) return;
  const [result] = await Review.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(String(productId)), status: "approved" } },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  await Product.updateOne(
    { _id: productId },
    { rating: result ? Math.round(result.average * 10) / 10 : 0, reviewCount: result?.count ?? 0 }
  );
}

/* ------------------------------ Public reads ------------------------------ */

router.get("/", async (req, res) => {
  try {
    await connectToDatabase();
    const productId = typeof req.query.productId === "string" ? req.query.productId : "";
    if (!mongoose.isValidObjectId(productId)) return res.json([]);

    const reviews = await Review.find({ productId, status: "approved" }).sort({ createdAt: -1 });
    res.json(reviews.map(publicReview));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/testimonials", async (req, res) => {
  try {
    await connectToDatabase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 24);
    const reviews = await Review.find({ status: "approved", isFeatured: true }).sort({ createdAt: -1 }).limit(limit);
    res.json(reviews.map(publicReview));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/* --------------------------- Customer submission --------------------------- */

router.post("/", requireCustomer(), async (req, res) => {
  try {
    await connectToDatabase();
    const customer = req.customer!;
    const body = req.body ?? {};

    const productId = typeof body.productId === "string" ? body.productId : "";
    const rating = Math.round(Number(body.rating));
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";

    if (!mongoose.isValidObjectId(productId) || !(await Product.exists({ _id: productId }))) {
      throw new HttpError(400, "That product doesn't exist.");
    }
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Please choose a rating from 1 to 5.");
    if (comment.length < 3) throw new HttpError(400, "Please write a few words about the product.");
    if (comment.length > 2000) throw new HttpError(400, "Reviews can be at most 2000 characters.");

    if (await Review.exists({ productId, customerId: customer.sub })) {
      throw new HttpError(409, "You've already reviewed this product.");
    }

    // "Verified purchase" = this customer has a (non-cancelled) order containing the product.
    const purchased = await Order.exists({
      "items.productId": productId,
      status: { $nin: ["cancelled", "returned", "refunded"] },
      $or: [{ customerId: customer.sub }, ...(customer.email ? [{ customerEmail: customer.email.toLowerCase() }] : [])],
    });

    const { store } = await getSettings();
    const status = store.autoApproveReviews ? "approved" : "pending";

    const review = await Review.create({
      productId,
      customerId: customer.sub,
      customerName: customer.name,
      rating,
      title,
      comment,
      isVerifiedPurchase: Boolean(purchased),
      status,
    });

    if (status === "approved") await recomputeProductRating(productId);
    res.status(201).json({ ...publicReview(review), status });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/* --------------------------- Customer self-service --------------------------- */

// So the storefront can offer "Edit your review" instead of a second submit
// (which would otherwise just 409 — one review per customer per product).
router.get("/mine", requireCustomer(), async (req, res) => {
  try {
    await connectToDatabase();
    const productId = typeof req.query.productId === "string" ? req.query.productId : "";
    if (!mongoose.isValidObjectId(productId)) return res.json({ review: null });

    const review = await Review.findOne({ productId, customerId: req.customer!.sub });
    res.json({ review: review ? { id: review.id, rating: review.rating, title: review.title, comment: review.comment, status: review.status } : null });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.put("/mine/:id", requireCustomer(), async (req, res) => {
  try {
    await connectToDatabase();
    const review = await Review.findById(req.params.id).catch(() => null);
    if (!review || review.customerId !== req.customer!.sub) {
      return res.status(404).json({ error: "Review not found." });
    }

    const body = req.body ?? {};
    const rating = Math.round(Number(body.rating));
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";

    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Please choose a rating from 1 to 5.");
    if (comment.length < 3) throw new HttpError(400, "Please write a few words about the product.");
    if (comment.length > 2000) throw new HttpError(400, "Reviews can be at most 2000 characters.");

    review.rating = rating;
    review.title = title;
    review.comment = comment;
    // An edited review goes back through moderation, same as a new one — otherwise
    // editing would be a way to swap an approved review's text for anything.
    const { store } = await getSettings();
    review.status = store.autoApproveReviews ? "approved" : "pending";

    await review.save();
    await recomputeProductRating(review.productId);
    res.json({ ...publicReview(review), status: review.status });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.delete("/mine/:id", requireCustomer(), async (req, res) => {
  try {
    await connectToDatabase();
    const review = await Review.findById(req.params.id).catch(() => null);
    if (!review || review.customerId !== req.customer!.sub) {
      return res.status(404).json({ error: "Review not found." });
    }

    const productId = review.productId;
    await review.deleteOne();
    await recomputeProductRating(productId);
    res.json({ success: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/* ------------------------------ Admin moderation ------------------------------ */

router.get("/admin/list", requireAdmin("reviews.view"), async (req, res) => {
  try {
    await connectToDatabase();
    const status = typeof req.query.status === "string" && (REVIEW_STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : undefined;
    const reviews = await Review.find(status ? { status } : {}).sort({ createdAt: -1 });

    const productIds = [...new Set(reviews.map((review) => String(review.productId ?? "")).filter(Boolean))];
    const products = await Product.find({ _id: { $in: productIds } }).select("name slug thumbnail");
    const byId = new Map(products.map((product) => [String(product._id), product]));

    res.json(
      reviews.map((review) => {
        const product = review.productId ? byId.get(String(review.productId)) : undefined;
        return { ...review.toJSON(), productName: product?.name ?? null, productSlug: product?.slug ?? null };
      })
    );
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

// Staff can add a review by hand — mostly store-level testimonials (no product) for the homepage.
router.post("/admin", requireAdmin("reviews.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const body = req.body ?? {};
    const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const rating = Math.round(Number(body.rating));
    const productId = typeof body.productId === "string" && body.productId ? body.productId : undefined;

    if (!customerName || !comment) throw new HttpError(400, "Name and review text are required.");
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Rating must be from 1 to 5.");
    if (productId && !(mongoose.isValidObjectId(productId) && (await Product.exists({ _id: productId })))) {
      throw new HttpError(400, "That product doesn't exist.");
    }

    const review = await Review.create({
      productId,
      customerName,
      rating,
      title: typeof body.title === "string" ? body.title.trim() : "",
      comment,
      isVerifiedPurchase: body.isVerifiedPurchase === true,
      isFeatured: body.isFeatured === true,
      status: "approved",
    });
    await recomputeProductRating(productId);
    res.status(201).json(review);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.patch("/:id", requireAdmin("reviews.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const review = await Review.findById(req.params.id).catch(() => null);
    if (!review) return res.status(404).json({ error: "Review not found." });

    const body = req.body ?? {};
    if (body.status !== undefined) {
      if (!(REVIEW_STATUSES as readonly string[]).includes(body.status)) throw new HttpError(400, "Invalid status.");
      review.status = body.status;
    }
    if (typeof body.isFeatured === "boolean") review.isFeatured = body.isFeatured;
    if (typeof body.moderationNote === "string") review.moderationNote = body.moderationNote.trim();

    // Only an approved review may be featured on the homepage.
    if (review.status !== "approved") review.isFeatured = false;

    await review.save();
    await recomputeProductRating(review.productId);
    res.json(review);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.delete("/:id", requireAdmin("reviews.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const review = await Review.findByIdAndDelete(req.params.id).catch(() => null);
    if (!review) return res.status(404).json({ error: "Review not found." });
    await recomputeProductRating(review.productId);
    res.json({ success: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
