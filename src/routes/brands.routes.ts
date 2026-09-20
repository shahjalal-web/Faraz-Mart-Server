import { Brand } from "../models/brand";
import { Product } from "../models/product";
import { createCrudRouter } from "../utils/crud";
import { HttpError } from "../utils/errors";

export default createCrudRouter({
  model: Brand,
  resource: "brands",
  fields: {
    name: "string",
    slug: "string",
    logo: "string",
    logoPublicId: "string",
    description: "string",
    website: "string",
    isActive: "boolean",
  },
  required: ["name", "slug"],
  sort: { name: 1 },
  publicFilter: () => ({ isActive: true }),
  lookupField: "slug",
  cloudinaryFields: ["logoPublicId"],

  // Products reference their brand by name, so a rename has to follow through to them.
  afterSave: async (doc, previous) => {
    if (previous && previous.name !== doc.name) {
      await Product.updateMany({ brand: previous.name }, { brand: doc.name });
    }
  },

  beforeDelete: async (existing) => {
    const brand = existing as unknown as { name: string };
    const inUse = await Product.countDocuments({ brand: brand.name });
    if (inUse > 0) {
      throw new HttpError(400, `${inUse} product${inUse === 1 ? "" : "s"} still use this brand — move or remove them first.`);
    }
  },

  decorateList: async (items) => {
    const counts = await Product.aggregate([{ $group: { _id: { $toLower: "$brand" }, count: { $sum: 1 } } }]);
    const byName = new Map<string, number>(counts.map((row) => [row._id as string, row.count as number]));
    return items.map((item) => ({ ...item, productCount: byName.get(String(item.name).toLowerCase()) ?? 0 }));
  },
});
