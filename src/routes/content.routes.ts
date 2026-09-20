import { Router } from "express";
import { Announcement } from "../models/announcement";
import { Faq } from "../models/faq";
import { Page, FOOTER_GROUPS } from "../models/page";
import { Setting } from "../models/setting";
import { connectToDatabase } from "../db";
import { requireAdmin } from "../middleware/require-admin";
import { activeWindowFilter } from "../utils/active-window";
import { createCrudRouter } from "../utils/crud";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";

/* ----------------------------- Announcements ----------------------------- */

export const announcementsRouter = createCrudRouter({
  model: Announcement,
  resource: "announcements",
  fields: {
    message: "string",
    linkLabel: "string",
    linkHref: "string",
    sortOrder: "number",
    startsAt: "date",
    endsAt: "date",
    isActive: "boolean",
  },
  required: ["message"],
  sort: { sortOrder: 1, createdAt: 1 },
  publicFilter: () => activeWindowFilter(),
  beforeSave: (payload) => {
    if (payload.startsAt instanceof Date && payload.endsAt instanceof Date && payload.endsAt < payload.startsAt) {
      throw new HttpError(400, "End date must be after the start date.");
    }
  },
});

/* ---------------------------------- FAQ ---------------------------------- */

export const faqRouter = createCrudRouter({
  model: Faq,
  resource: "faq",
  fields: { question: "string", answer: "string", category: "string", sortOrder: "number", isPublished: "boolean" },
  required: ["question", "answer"],
  sort: { category: 1, sortOrder: 1, createdAt: 1 },
  publicFilter: () => ({ isPublished: true }),
});

/* --------------------------------- Pages --------------------------------- */

export const pagesRouter = createCrudRouter({
  model: Page,
  resource: "pages",
  fields: {
    title: "string",
    slug: "string",
    content: "string",
    isPublished: "boolean",
    showInFooter: "boolean",
    footerGroup: "string",
    seoTitle: "string",
    seoDescription: "string",
  },
  required: ["title", "slug"],
  sort: { title: 1 },
  publicFilter: () => ({ isPublished: true }),
  lookupField: "slug",
  beforeSave: (payload) => {
    if (payload.footerGroup !== undefined && !(FOOTER_GROUPS as readonly string[]).includes(payload.footerGroup as string)) {
      throw new HttpError(400, "Footer group must be customer-service or company.");
    }
    if (typeof payload.slug === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug.toLowerCase())) {
      throw new HttpError(400, "Slug can only use letters, numbers and dashes.");
    }
  },
});

/* ------------------------------ Homepage config ------------------------------ */

export const HOMEPAGE_SECTION_KEYS = [
  "hero",
  "categories",
  "featured",
  "flash-sale",
  "new-arrivals",
  "best-sellers",
  "promo-banners",
  "why-shop",
  "testimonials",
  "newsletter",
] as const;

export const HOMEPAGE_FEATURE_ICONS = ["shield", "truck", "rotate", "headset", "gift", "heart", "star", "clock", "lock", "badge"] as const;

interface HomepageSection {
  key: (typeof HOMEPAGE_SECTION_KEYS)[number];
  enabled: boolean;
  /** Empty = keep the section's built-in heading. */
  title: string;
  subtitle: string;
  /** How many items the section lists (only used by product/category sections). */
  limit: number | null;
}

interface HomepageFeature {
  icon: string;
  title: string;
  description: string;
}

export interface HomepageConfig {
  sections: HomepageSection[];
  features: HomepageFeature[];
}

const DEFAULT_LIMITS: Partial<Record<HomepageSection["key"], number>> = {
  categories: 8,
  featured: 8,
  "flash-sale": 10,
  "new-arrivals": 10,
  "best-sellers": 10,
  testimonials: 6,
};

export const DEFAULT_HOMEPAGE_CONFIG: HomepageConfig = {
  sections: HOMEPAGE_SECTION_KEYS.map((key) => ({
    key,
    enabled: true,
    title: "",
    subtitle: "",
    limit: DEFAULT_LIMITS[key] ?? null,
  })),
  features: [
    { icon: "shield", title: "Secure Payments", description: "Every transaction is encrypted and protected end to end." },
    { icon: "truck", title: "Fast Delivery", description: "Reliable shipping with real-time order tracking." },
    { icon: "rotate", title: "Easy Returns", description: "Changed your mind? Return most items within 30 days." },
    { icon: "headset", title: "Customer Support", description: "Our team is here for you, every day of the week." },
  ],
};

/** Merges whatever is stored with the defaults so a missing section (or one added in a later release) still shows up. */
function normaliseHomepageConfig(stored: unknown): HomepageConfig {
  const input = (typeof stored === "object" && stored !== null ? stored : {}) as Partial<HomepageConfig>;
  const storedSections = Array.isArray(input.sections) ? input.sections : [];

  const sections: HomepageSection[] = [];
  for (const entry of storedSections) {
    const key = (entry as HomepageSection)?.key;
    if (!HOMEPAGE_SECTION_KEYS.includes(key) || sections.some((section) => section.key === key)) continue;

    const limit = Number((entry as HomepageSection).limit);
    sections.push({
      key,
      enabled: (entry as HomepageSection).enabled !== false,
      title: typeof (entry as HomepageSection).title === "string" ? (entry as HomepageSection).title.trim() : "",
      subtitle: typeof (entry as HomepageSection).subtitle === "string" ? (entry as HomepageSection).subtitle.trim() : "",
      limit: DEFAULT_LIMITS[key] === undefined ? null : Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 24) : DEFAULT_LIMITS[key]!,
    });
  }
  for (const fallback of DEFAULT_HOMEPAGE_CONFIG.sections) {
    if (!sections.some((section) => section.key === fallback.key)) sections.push({ ...fallback });
  }

  const features: HomepageFeature[] = Array.isArray(input.features)
    ? input.features
        .filter((f): f is HomepageFeature => typeof f?.title === "string" && f.title.trim() !== "")
        .slice(0, 8)
        .map((f) => ({
          icon: (HOMEPAGE_FEATURE_ICONS as readonly string[]).includes(f.icon) ? f.icon : "star",
          title: f.title.trim(),
          description: typeof f.description === "string" ? f.description.trim() : "",
        }))
    : DEFAULT_HOMEPAGE_CONFIG.features;

  return { sections, features };
}

export const homepageRouter = Router();

// Public: the storefront home page reads this to know which sections to show, in what order.
homepageRouter.get("/", async (_req, res) => {
  try {
    await connectToDatabase();
    const doc = await Setting.findOne({ key: "homepage" });
    res.json(normaliseHomepageConfig(doc?.value));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

homepageRouter.put("/", requireAdmin("homepage.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const config = normaliseHomepageConfig(req.body);
    await Setting.findOneAndUpdate({ key: "homepage" }, { key: "homepage", value: config }, { upsert: true });
    res.json(config);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});
