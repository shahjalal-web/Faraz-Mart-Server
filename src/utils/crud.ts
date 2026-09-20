import { Router, type Request } from "express";
import mongoose, { type Model } from "mongoose";
import { connectToDatabase } from "../db";
import { adminCan, requireAdmin } from "../middleware/require-admin";
import { deleteCloudinaryImage } from "../cloudinary";
import { errorMessage, errorStatus, HttpError } from "./errors";

export type FieldType = "string" | "number" | "boolean" | "date" | "stringArray" | "ref" | "json";

/**
 * Picks only the whitelisted fields out of a request body and coerces them,
 * so a client can never write a field the resource doesn't declare
 * (usedCount, timestamps, ids, ...). "" / null clears an optional field.
 */
export function buildPayload(body: Record<string, unknown>, fields: Record<string, FieldType>) {
  const payload: Record<string, unknown> = {};

  for (const [field, type] of Object.entries(fields)) {
    if (!(field in body)) continue;
    const raw = body[field];

    switch (type) {
      case "string":
        if (typeof raw === "string") payload[field] = raw.trim();
        else if (raw === null) payload[field] = "";
        break;
      case "number":
        if (raw === "" || raw === null) payload[field] = undefined;
        else if (Number.isFinite(Number(raw))) payload[field] = Number(raw);
        break;
      case "boolean":
        if (typeof raw === "boolean") payload[field] = raw;
        break;
      case "date":
        if (raw === "" || raw === null) payload[field] = undefined;
        else if (typeof raw === "string" && !Number.isNaN(new Date(raw).getTime())) payload[field] = new Date(raw);
        break;
      case "stringArray":
        if (Array.isArray(raw)) payload[field] = raw.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
        break;
      case "ref":
        if (raw === "" || raw === null) payload[field] = null;
        else if (typeof raw === "string") payload[field] = raw;
        break;
      case "json":
        if (raw !== undefined) payload[field] = raw;
        break;
    }
  }

  return payload;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- routes are model-agnostic; each model file owns its own typing
type AnyModel = Model<any>;
type Payload = Record<string, unknown>;

export interface CrudOptions {
  model: AnyModel;
  /** Permission resource key — GET-list needs `<resource>.view`, writes need `<resource>.manage`. */
  resource: string;
  fields: Record<string, FieldType>;
  required?: string[];
  sort?: Record<string, 1 | -1>;
  /**
   * Makes reads public: anonymous visitors (the storefront) get only records
   * matching this filter; an admin with `<resource>.view` gets everything.
   * Omit it and the list/get endpoints are admin-only.
   */
  publicFilter?: () => Record<string, unknown>;
  /** Lets GET /:idOrSlug also resolve by this field (e.g. "slug") when it isn't an ObjectId. */
  lookupField?: string;
  /** Query-string params (?placement=hero) that narrow the list with a simple equality filter. */
  queryFilters?: string[];
  /** Names of fields holding Cloudinary public_ids — those images are deleted when replaced or when the record is deleted. */
  cloudinaryFields?: string[];
  /** Validate / normalise / derive fields. Throw HttpError to reject. */
  beforeSave?: (payload: Payload, existing: Payload | null, req: Request) => Promise<void> | void;
  afterSave?: (doc: Payload & { _id: unknown }, previous: Payload | null) => Promise<void> | void;
  beforeDelete?: (existing: { _id: unknown }, req: Request) => Promise<void> | void;
  afterDelete?: (existing: { _id: unknown }) => Promise<void> | void;
  /** Reshape the admin list (e.g. attach counts). Receives plain JSON objects. */
  decorateList?: (items: Payload[]) => Promise<Payload[]> | Payload[];
}

function isObjectId(value: string) {
  return mongoose.isValidObjectId(value);
}

async function deleteImages(publicIds: unknown[]) {
  await Promise.all(
    publicIds
      .filter((id): id is string => typeof id === "string" && id !== "")
      .map((id) => deleteCloudinaryImage(id).catch((error) => console.error(`Failed to delete Cloudinary image ${id}:`, error)))
  );
}

export function createCrudRouter(options: CrudOptions): Router {
  const { model, resource, fields, required = [], sort = { createdAt: -1 }, publicFilter, lookupField, cloudinaryFields = [] } = options;
  const router = Router();

  const respondError = (res: import("express").Response, error: unknown) =>
    res.status(errorStatus(error)).json({ error: errorMessage(error) });

  router.get("/", async (req, res) => {
    try {
      await connectToDatabase();

      let filter: Record<string, unknown> = {};
      if (publicFilter) {
        if (!(await adminCan(req, `${resource}.view`))) filter = publicFilter();
      } else {
        // Admin-only list: reuse the standard gate so 401/403 behave like every other route.
        let allowed = false;
        await requireAdmin(`${resource}.view`)(req, res, () => {
          allowed = true;
        });
        if (!allowed) return;
      }

      for (const name of options.queryFilters ?? []) {
        const value = req.query[name];
        if (typeof value === "string" && value !== "") filter = { ...filter, [name]: value };
      }

      const docs = await model.find(filter).sort(sort);
      let items = docs.map((doc) => doc.toJSON() as Payload);
      if (options.decorateList) items = await options.decorateList(items);
      res.json(items);
    } catch (error) {
      respondError(res, error);
    }
  });

  router.get("/:idOrSlug", async (req, res) => {
    try {
      await connectToDatabase();
      const { idOrSlug } = req.params;

      let filter: Record<string, unknown> = {};
      if (publicFilter) {
        if (!(await adminCan(req, `${resource}.view`))) filter = publicFilter();
      } else {
        let allowed = false;
        await requireAdmin(`${resource}.view`)(req, res, () => {
          allowed = true;
        });
        if (!allowed) return;
      }

      const lookup = isObjectId(idOrSlug) ? { _id: idOrSlug } : lookupField ? { [lookupField]: idOrSlug } : null;
      if (!lookup) return res.status(404).json({ error: "Not found." });

      const doc = await model.findOne({ ...filter, ...lookup });
      if (!doc) return res.status(404).json({ error: "Not found." });
      res.json(doc);
    } catch (error) {
      respondError(res, error);
    }
  });

  router.post("/", requireAdmin(`${resource}.manage`), async (req, res) => {
    try {
      await connectToDatabase();
      const payload = buildPayload(req.body ?? {}, fields);
      await options.beforeSave?.(payload, null, req);

      const missing = required.filter((field) => payload[field] === undefined || payload[field] === "" || payload[field] === null);
      if (missing.length > 0) {
        throw new HttpError(400, `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`);
      }

      const doc = await model.create(payload);
      await options.afterSave?.(doc.toObject() as Payload & { _id: unknown }, null);
      res.status(201).json(doc);
    } catch (error) {
      respondError(res, error);
    }
  });

  router.put("/:id", requireAdmin(`${resource}.manage`), async (req, res) => {
    try {
      await connectToDatabase();
      const existing = await model.findById(req.params.id).catch(() => null);
      if (!existing) return res.status(404).json({ error: "Not found." });

      const payload = buildPayload(req.body ?? {}, fields);
      await options.beforeSave?.(payload, existing.toObject() as Payload, req);

      const previous = existing.toObject() as Payload;
      const previousImages = cloudinaryFields.map((field) => existing.get(field));
      Object.assign(existing, payload);

      const missing = required.filter((field) => {
        const value = existing.get(field);
        return value === undefined || value === "" || value === null;
      });
      if (missing.length > 0) {
        throw new HttpError(400, `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`);
      }

      await existing.save();

      const replaced = cloudinaryFields
        .map((field, index) => ({ before: previousImages[index], after: existing.get(field) }))
        .filter(({ before, after }) => before && before !== after)
        .map(({ before }) => before);
      await deleteImages(replaced);
      await options.afterSave?.(existing.toObject() as Payload & { _id: unknown }, previous);

      res.json(existing);
    } catch (error) {
      respondError(res, error);
    }
  });

  router.delete("/:id", requireAdmin(`${resource}.manage`), async (req, res) => {
    try {
      await connectToDatabase();
      const existing = await model.findById(req.params.id).catch(() => null);
      if (!existing) return res.status(404).json({ error: "Not found." });

      await options.beforeDelete?.(existing, req);
      await existing.deleteOne();
      await deleteImages(cloudinaryFields.map((field) => existing.get(field)));
      await options.afterDelete?.(existing);

      res.json({ success: true });
    } catch (error) {
      respondError(res, error);
    }
  });

  return router;
}
