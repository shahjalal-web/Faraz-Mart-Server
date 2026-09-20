/**
 * Seeds the content/settings that used to live as mock data in the frontend
 * (fazar-mart/data/*) — plus the built-in admin roles — into MongoDB, so the
 * new admin sections start populated instead of empty.
 * Run with: npm run seed:defaults (from inside back-end/)
 *
 * Safe to re-run: each collection is only filled when it is completely empty,
 * so it never overwrites or duplicates anything an admin has since created.
 * Product-linked seeds (brands, attributes, reviews) read the migrated
 * products from MongoDB, so run `npm run migrate:catalog` first.
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import mongoose from "mongoose";
import { connectToDatabase } from "../src/db";
import { ensureDefaultRoles } from "../src/routes/roles.routes";
import { Announcement } from "../src/models/announcement";
import { Attribute } from "../src/models/attribute";
import { Banner } from "../src/models/banner";
import { Brand } from "../src/models/brand";
import { Coupon } from "../src/models/coupon";
import { CustomerGroup } from "../src/models/customer-group";
import { Faq } from "../src/models/faq";
import { Page } from "../src/models/page";
import { Product } from "../src/models/product";
import { Review } from "../src/models/review";
import { slugify } from "../src/utils/slug";
import { coupons as mockCoupons } from "../../fazar-mart/data/coupons";
import { heroSlides, promoBanners } from "../../fazar-mart/data/hero-slides";
import { productReviews } from "../../fazar-mart/data/product-reviews";
import { products as mockProducts } from "../../fazar-mart/data/products";
import { testimonials } from "../../fazar-mart/data/testimonials";

/** The old banner data stored raw Tailwind classes; the database stores a preset key (see the storefront's lib/gradients.ts). */
const GRADIENT_KEYS: Record<string, string> = {
  "from-[#FF6A3D] via-[#FF3D77] to-[#6D5DF6]": "sunrise",
  "from-[#6D5DF6] via-[#FF3D77] to-[#FFB020]": "violet-sunset",
  "from-[#14B8A6] via-[#4F46E5] to-[#FF3D77]": "ocean-teal",
  "from-[#FF3D77] to-[#6D5DF6]": "rose-violet",
  "from-[#38BDF8] to-[#4F46E5]": "sky-indigo",
};

const FAQS = [
  ["Orders", "How do I place an order?", "Browse the shop, add what you like to your cart and choose Checkout. You can check out as a guest or sign in first to keep your order history in one place."],
  ["Orders", "Can I change or cancel my order?", "You can cancel an order while it is still Pending or Confirmed. Contact our support team as soon as possible and we will help. Once an order has been packed or shipped it can no longer be changed, but you can return it after delivery."],
  ["Orders", "How do I track my order?", "Open My Orders from your account (or use the link on your order confirmation) to see the live status: Order Placed, Confirmed, Processing, Packed, Shipped, Out for Delivery and Delivered."],
  ["Shipping", "How long does delivery take?", "Standard delivery takes 3–5 business days and Express delivery takes 1–2 business days. Delivery costs and the free-shipping threshold are shown at checkout."],
  ["Shipping", "Do you offer free shipping?", "Yes — orders over the free-shipping threshold ship free with Standard delivery, and some coupons and promotions include free shipping as well."],
  ["Returns", "What is your return policy?", "Most items can be returned within 30 days of delivery in their original condition. See our Return & Refund Policy page for the full details."],
  ["Returns", "When will I receive my refund?", "Refunds are issued to your original payment method within 3–5 business days after we receive and inspect the returned item."],
  ["Payments", "Which payment methods do you accept?", "We accept credit and debit cards, Cash on Delivery and mobile banking. The methods available to you are shown at checkout."],
  ["Payments", "How do I use a coupon code?", "Enter your code in the Coupon field on the cart or checkout page and press Apply. The discount appears in your order summary straight away."],
  ["Account", "Do I need an account to shop?", "No — guest checkout is available. An account lets you track orders, save a wishlist and write product reviews."],
  ["Account", "I forgot my password. What can I do?", "Please contact our support team and we will help you get back into your account."],
] as const;

const PAGES = [
  {
    title: "About Us",
    slug: "about-us",
    footerGroup: "company" as const,
    content: `# About Faraz Mart

Faraz Mart is a modern multi-category marketplace built around three simple ideas: **quality products**, **fast delivery** and **support that actually helps**.

## What we do

We bring together electronics, fashion, home essentials, beauty and more in one trusted place, so you don't need five different apps to get what you need.

## Our promise

- Genuine products from brands we trust
- Transparent prices — what you see at checkout is what you pay
- Easy 30-day returns on most items
- A support team that answers quickly

Questions? Visit our [Contact Us](/contact-us) page — we'd love to hear from you.`,
  },
  {
    title: "Contact Us",
    slug: "contact-us",
    footerGroup: "customer-service" as const,
    content: `# Contact Us

We're here to help, every day of the week.

## Get in touch

- **Email:** support@farazmart.com
- **Phone:** +1 (800) 555-1234
- **Address:** 42 Dawn Avenue, Suite 100, New York

## Before you write

Many questions are already answered in our [FAQ](/faq). For an existing order, please have your order number (it looks like FM-123456) ready so we can help faster.`,
  },
  {
    title: "Shipping Policy",
    slug: "shipping-policy",
    footerGroup: "customer-service" as const,
    content: `# Shipping Policy

## Delivery options

- **Standard delivery:** 3–5 business days
- **Express delivery:** 1–2 business days

Shipping costs are calculated at checkout. Orders above the free-shipping threshold ship free with Standard delivery.

## Processing time

Orders are processed within one business day. You can follow every step from the My Orders page.

## Delivery issues

If your parcel arrives damaged or doesn't arrive within the expected window, contact us and we'll make it right.`,
  },
  {
    title: "Return & Refund Policy",
    slug: "return-refund-policy",
    footerGroup: "customer-service" as const,
    content: `# Return & Refund Policy

## Returns

You can return most items within **30 days** of delivery, as long as they are unused and in their original packaging.

## How to return an item

- Contact our support team with your order number
- We'll confirm the return and tell you how to send the item back
- Once we receive and inspect it, we'll process your refund

## Refunds

Refunds go back to your original payment method within 3–5 business days of us receiving the item.`,
  },
  {
    title: "Privacy Policy",
    slug: "privacy-policy",
    footerGroup: "company" as const,
    content: `# Privacy Policy

Your privacy matters to us. This page explains what we collect and why.

## What we collect

- Account details you give us: name, email address and phone number
- Order details: items, delivery address and payment method
- Basic usage information that helps us keep the store working well

## How we use it

We use your information to process orders, provide support and improve the store. We do not sell your personal information.

## Your choices

You can ask us to correct or delete your account at any time by contacting [support](/contact-us).`,
  },
  {
    title: "Terms & Conditions",
    slug: "terms-conditions",
    footerGroup: "company" as const,
    content: `# Terms & Conditions

By using Faraz Mart you agree to the terms below.

## Orders and prices

All prices are shown at checkout and may change without notice. An order is confirmed once we accept it; we may cancel an order if an item is unavailable or a price was shown in error.

## Accounts

You are responsible for keeping your login details safe and for activity on your account.

## Returns

Returns and refunds are governed by our [Return & Refund Policy](/return-refund-policy).

## Changes

We may update these terms from time to time. Continued use of the store means you accept the updated terms.`,
  },
];

async function seedIfEmpty(label: string, count: () => Promise<number>, insert: () => Promise<number>) {
  if ((await count()) > 0) {
    console.log(`- ${label}: already has data, skipped`);
    return;
  }
  console.log(`- ${label}: added ${await insert()}`);
}

async function main() {
  await connectToDatabase();

  await ensureDefaultRoles();
  console.log("- roles: built-in roles ensured");

  await seedIfEmpty("announcements", () => Announcement.countDocuments(), async () => {
    const messages = ["Free delivery on orders over $50", "New arrivals dropping every week", "Flash deals up to 60% off — while stock lasts"];
    await Announcement.insertMany(messages.map((message, index) => ({ message, sortOrder: index })));
    return messages.length;
  });

  await seedIfEmpty("banners", () => Banner.countDocuments(), async () => {
    const hero = heroSlides.map((slide, index) => ({
      placement: "hero",
      eyebrow: slide.eyebrow,
      title: slide.title,
      highlight: slide.highlight,
      description: slide.description,
      ctaLabel: slide.ctaLabel,
      ctaHref: slide.ctaHref,
      secondaryCtaLabel: slide.secondaryCtaLabel,
      secondaryCtaHref: slide.secondaryCtaHref,
      gradient: GRADIENT_KEYS[slide.gradient] ?? "sunrise",
      sortOrder: index,
    }));
    const promo = promoBanners.map((banner, index) => ({
      placement: "promo",
      title: banner.title,
      description: banner.description,
      ctaLabel: banner.ctaLabel,
      ctaHref: banner.ctaHref,
      gradient: GRADIENT_KEYS[banner.gradient] ?? "rose-violet",
      sortOrder: index,
    }));
    await Banner.insertMany([...hero, ...promo]);
    return hero.length + promo.length;
  });

  await seedIfEmpty("faq", () => Faq.countDocuments(), async () => {
    await Faq.insertMany(FAQS.map(([category, question, answer], index) => ({ category, question, answer, sortOrder: index })));
    return FAQS.length;
  });

  await seedIfEmpty("pages", () => Page.countDocuments(), async () => {
    await Page.insertMany(PAGES.map((page) => ({ ...page, isPublished: true, showInFooter: true })));
    return PAGES.length;
  });

  await seedIfEmpty("coupons", () => Coupon.countDocuments(), async () => {
    await Coupon.insertMany(mockCoupons.map((coupon) => ({ code: coupon.code, type: coupon.type, value: coupon.value, description: coupon.description })));
    return mockCoupons.length;
  });

  await seedIfEmpty("customer groups", () => CustomerGroup.countDocuments(), async () => {
    await CustomerGroup.insertMany([
      { name: "VIP", description: "Loyal, high-spending customers." },
      { name: "Wholesale", description: "Business buyers ordering in bulk." },
    ]);
    return 2;
  });

  await seedIfEmpty("brands", () => Brand.countDocuments(), async () => {
    const names = [...new Set((await Product.find().select("brand")).map((product) => product.brand as string))].sort();
    await Brand.insertMany(names.map((name) => ({ name, slug: slugify(name) })));
    return names.length;
  });

  await seedIfEmpty("attributes", () => Attribute.countDocuments(), async () => {
    const colors = new Map<string, string | undefined>();
    const sizes = new Set<string>();
    for (const product of mockProducts) {
      for (const color of product.colors ?? []) if (!colors.has(color.value)) colors.set(color.value, color.hex);
      for (const size of product.sizes ?? []) sizes.add(size.value);
    }

    await Attribute.insertMany([
      {
        name: "Color",
        slug: "color",
        type: "color",
        values: [...colors.entries()].map(([label, hex]) => ({ label, value: slugify(label), ...(hex ? { hex } : {}) })),
      },
      { name: "Size", slug: "size", type: "size", values: [...sizes].map((label) => ({ label, value: slugify(label) })) },
    ]);
    return 2;
  });

  await seedIfEmpty("reviews", () => Review.countDocuments(), async () => {
    const slugByMockId = new Map(mockProducts.map((product) => [product.id, product.slug]));
    const realIdBySlug = new Map((await Product.find().select("slug")).map((product) => [product.slug as string, product._id]));

    const docs = [];
    for (const review of productReviews) {
      const productId = realIdBySlug.get(slugByMockId.get(review.productId) ?? "");
      if (!productId) continue;
      docs.push({
        productId,
        customerName: review.customerName,
        rating: review.rating,
        title: review.title ?? "",
        comment: review.comment,
        isVerifiedPurchase: review.isVerifiedPurchase,
        status: "approved",
        createdAt: new Date(review.date),
      });
    }
    // The old homepage testimonials were store-level, not tied to a product.
    for (const testimonial of testimonials) {
      docs.push({
        customerName: testimonial.customerName,
        rating: testimonial.rating,
        comment: testimonial.comment,
        isVerifiedPurchase: testimonial.isVerifiedPurchase,
        status: "approved",
        isFeatured: true,
        createdAt: new Date(testimonial.date),
      });
    }
    await Review.insertMany(docs);
    return docs.length;
  });

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
