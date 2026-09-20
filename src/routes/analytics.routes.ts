import { Router, type Request } from "express";
import { connectToDatabase } from "../db";
import { Order } from "../models/order";
import { Customer } from "../models/customer";
import { CustomerGroup } from "../models/customer-group";
import { Category } from "../models/category";
import { Product } from "../models/product";
import { requireAdmin } from "../middleware/require-admin";
import { getSettings } from "../services/settings";
import { errorMessage, errorStatus } from "../utils/errors";

/**
 * Read-only reporting. Every figure is computed from real orders / customers /
 * products at request time — nothing is cached or stored separately, so the
 * numbers can never drift from the data behind them.
 *
 * "Revenue" and "sales" count orders that are still standing: cancelled,
 * returned and refunded orders are left out. Order-volume reports (the
 * Orders page) count every order, since cancellations are part of that story.
 */
const router = Router();
router.use(requireAdmin("analytics.view"));

const DAY_MS = 24 * 60 * 60 * 1000;
const EXCLUDED_FROM_REVENUE = ["cancelled", "returned", "refunded"];
const RANGES = { "7d": 7, "30d": 30, "90d": 90, "365d": 365, all: null } as const;
type RangeKey = keyof typeof RANGES;

const round2 = (value: number) => Math.round(value * 100) / 100;

interface Period {
  range: RangeKey;
  start: Date | null;
  end: Date;
  previousStart: Date | null;
  granularity: "day" | "month";
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function resolvePeriod(req: Request): Promise<Period> {
  const requested = String(req.query.range ?? "30d");
  const range: RangeKey = requested in RANGES ? (requested as RangeKey) : "30d";
  const days = RANGES[range];
  const end = new Date();

  if (days === null) {
    const first = await Order.findOne().sort({ createdAt: 1 }).select("createdAt");
    return { range, start: first ? startOfDay(first.createdAt as Date) : startOfDay(end), end, previousStart: null, granularity: "month" };
  }

  const start = startOfDay(new Date(end.getTime() - (days - 1) * DAY_MS));
  return {
    range,
    start,
    end,
    previousStart: new Date(start.getTime() - days * DAY_MS),
    granularity: days > 90 ? "month" : "day",
  };
}

function dateMatch(period: Period, field = "createdAt") {
  return period.start ? { [field]: { $gte: period.start, $lte: period.end } } : {};
}

function bucketFormat(granularity: Period["granularity"]) {
  return granularity === "day" ? "%Y-%m-%d" : "%Y-%m";
}

/** Every bucket between start and end, so charts get a zero for days with no orders instead of a gap. */
function bucketKeys(period: Period): string[] {
  if (!period.start) return [];
  const keys: string[] = [];
  const cursor = new Date(period.start);

  if (period.granularity === "day") {
    while (cursor <= period.end) {
      keys.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else {
    cursor.setUTCDate(1);
    while (cursor <= period.end) {
      keys.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return keys;
}

function fillSeries<T extends { date: string }>(period: Period, rows: T[], empty: Omit<T, "date">): T[] {
  const byKey = new Map(rows.map((row) => [row.date, row]));
  const keys = period.start ? bucketKeys(period) : rows.map((row) => row.date).sort();
  return keys.map((key) => byKey.get(key) ?? ({ date: key, ...empty } as T));
}

function percentChange(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

/** Sums used by the "vs previous period" comparison. */
async function totalsFor(match: Record<string, unknown>) {
  const [row] = await Order.aggregate([
    { $match: { ...match, status: { $nin: EXCLUDED_FROM_REVENUE } } },
    {
      $group: {
        _id: null,
        revenue: { $sum: "$total" },
        orders: { $sum: 1 },
        gross: { $sum: "$subtotal" },
        discounts: { $sum: "$discount" },
        shipping: { $sum: "$shipping" },
        tax: { $sum: "$tax" },
        items: { $sum: { $sum: "$items.quantity" } },
      },
    },
  ]);
  const revenue = round2(row?.revenue ?? 0);
  const orders = row?.orders ?? 0;
  return {
    revenue,
    orders,
    gross: round2(row?.gross ?? 0),
    discounts: round2(row?.discounts ?? 0),
    shipping: round2(row?.shipping ?? 0),
    tax: round2(row?.tax ?? 0),
    itemsSold: row?.items ?? 0,
    averageOrderValue: orders > 0 ? round2(revenue / orders) : 0,
  };
}

async function previousTotals(period: Period) {
  if (!period.previousStart || !period.start) return null;
  return totalsFor({ createdAt: { $gte: period.previousStart, $lt: period.start } });
}

/** Orders keep the id of a category that may since have been deleted — fold all those into one honest row. */
function mergeByName<T extends { name: string }>(rows: T[], combine: (a: T, b: T) => T): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const existing = merged.get(row.name);
    merged.set(row.name, existing ? combine(existing, row) : row);
  }
  return [...merged.values()];
}

function wrap(handler: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: import("express").Response) => {
    try {
      await connectToDatabase();
      res.json(await handler(req));
    } catch (error) {
      res.status(errorStatus(error)).json({ error: errorMessage(error) });
    }
  };
}

/* --------------------------------- Sales --------------------------------- */

router.get(
  "/sales",
  wrap(async (req) => {
    const period = await resolvePeriod(req);
    const match = { ...dateMatch(period), status: { $nin: EXCLUDED_FROM_REVENUE } };

    const [totals, previous, series, byPayment, byDelivery] = await Promise.all([
      totalsFor(dateMatch(period)),
      previousTotals(period),
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: bucketFormat(period.granularity), date: "$createdAt" } },
            revenue: { $sum: "$total" },
            orders: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([{ $match: match }, { $group: { _id: "$paymentMethod", orders: { $sum: 1 }, revenue: { $sum: "$total" } } }, { $sort: { revenue: -1 } }]),
      Order.aggregate([{ $match: match }, { $group: { _id: "$deliveryMethod", orders: { $sum: 1 }, revenue: { $sum: "$total" } } }, { $sort: { revenue: -1 } }]),
    ]);

    return {
      range: period.range,
      granularity: period.granularity,
      totals,
      change: {
        revenue: percentChange(totals.revenue, previous?.revenue),
        orders: percentChange(totals.orders, previous?.orders),
        averageOrderValue: percentChange(totals.averageOrderValue, previous?.averageOrderValue),
      },
      series: fillSeries(
        period,
        series.map((row) => ({ date: row._id as string, revenue: round2(row.revenue), orders: row.orders as number })),
        { revenue: 0, orders: 0 }
      ),
      byPaymentMethod: byPayment.map((row) => ({ key: row._id as string, orders: row.orders as number, revenue: round2(row.revenue) })),
      byDelivery: byDelivery.map((row) => ({ key: row._id as string, orders: row.orders as number, revenue: round2(row.revenue) })),
    };
  })
);

/* --------------------------------- Orders --------------------------------- */

router.get(
  "/orders",
  wrap(async (req) => {
    const period = await resolvePeriod(req);
    const match = dateMatch(period);

    const [byStatus, series, recent, previousCount, itemStats] = await Promise.all([
      Order.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: bucketFormat(period.granularity), date: "$createdAt" } }, orders: { $sum: 1 } } },
      ]),
      Order.find(match).sort({ createdAt: -1 }).limit(8).select("customerName total status createdAt"),
      period.previousStart && period.start
        ? Order.countDocuments({ createdAt: { $gte: period.previousStart, $lt: period.start } })
        : Promise.resolve<number | null>(null),
      Order.aggregate([{ $match: match }, { $group: { _id: null, items: { $sum: { $sum: "$items.quantity" } }, orders: { $sum: 1 } } }]),
    ]);

    const counts = new Map<string, number>(byStatus.map((row) => [row._id as string, row.count as number]));
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    const lost = (counts.get("cancelled") ?? 0) + (counts.get("returned") ?? 0) + (counts.get("refunded") ?? 0);

    return {
      range: period.range,
      granularity: period.granularity,
      totals: {
        orders: total,
        pending: counts.get("pending") ?? 0,
        delivered: counts.get("delivered") ?? 0,
        cancelled: counts.get("cancelled") ?? 0,
        returned: (counts.get("returned") ?? 0) + (counts.get("refunded") ?? 0),
        cancellationRate: total > 0 ? round2((lost / total) * 100) : 0,
        itemsPerOrder: itemStats[0]?.orders ? round2(itemStats[0].items / itemStats[0].orders) : 0,
      },
      change: { orders: percentChange(total, previousCount ?? undefined) },
      byStatus: [...counts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
      series: fillSeries(period, series.map((row) => ({ date: row._id as string, orders: row.orders as number })), { orders: 0 }),
      recent: recent.map((order) => ({
        id: order.id as string,
        customerName: order.customerName as string,
        total: order.total as number,
        status: order.status as string,
        createdAt: (order.createdAt as Date).toISOString(),
      })),
    };
  })
);

/* -------------------------------- Customers -------------------------------- */

router.get(
  "/customers",
  wrap(async (req) => {
    const period = await resolvePeriod(req);
    const orderMatch = { ...dateMatch(period), status: { $nin: EXCLUDED_FROM_REVENUE } };

    const [totalCustomers, activeCustomers, newCustomers, previousNew, signups, top, groups, methods, orderSplit, repeat] = await Promise.all([
      Customer.countDocuments(),
      Customer.countDocuments({ isActive: true }),
      Customer.countDocuments(dateMatch(period)),
      period.previousStart && period.start
        ? Customer.countDocuments({ createdAt: { $gte: period.previousStart, $lt: period.start } })
        : Promise.resolve<number | null>(null),
      Customer.aggregate([
        { $match: dateMatch(period) },
        { $group: { _id: { $dateToString: { format: bucketFormat(period.granularity), date: "$createdAt" } }, customers: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $group: { _id: "$customerEmail", name: { $last: "$customerName" }, orders: { $sum: 1 }, spent: { $sum: "$total" } } },
        { $sort: { spent: -1 } },
        { $limit: 10 },
      ]),
      Customer.aggregate([{ $group: { _id: "$groupId", count: { $sum: 1 } } }]),
      Customer.aggregate([
        {
          $group: {
            _id: {
              $switch: {
                branches: [
                  { case: { $and: [{ $ne: [{ $ifNull: ["$passwordHash", null] }, null] }, { $ne: [{ $ifNull: ["$googleId", null] }, null] }] }, then: "password + google" },
                  { case: { $ne: [{ $ifNull: ["$googleId", null] }, null] }, then: "google" },
                ],
                default: "password",
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $group: { _id: { $cond: [{ $ifNull: ["$customerId", false] }, "registered", "guest"] }, orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
      ]),
      Order.aggregate([
        { $match: { status: { $nin: EXCLUDED_FROM_REVENUE } } },
        { $group: { _id: "$customerEmail", orders: { $sum: 1 } } },
        { $group: { _id: null, buyers: { $sum: 1 }, repeatBuyers: { $sum: { $cond: [{ $gt: ["$orders", 1] }, 1, 0] } } } },
      ]),
    ]);

    const groupRecords = await CustomerGroup.find();
    const groupNames = new Map(groupRecords.map((group) => [String(group._id), group.name as string]));

    return {
      range: period.range,
      granularity: period.granularity,
      totals: {
        customers: totalCustomers,
        active: activeCustomers,
        newCustomers,
        buyers: repeat[0]?.buyers ?? 0,
        repeatBuyers: repeat[0]?.repeatBuyers ?? 0,
        repeatRate: repeat[0]?.buyers ? round2((repeat[0].repeatBuyers / repeat[0].buyers) * 100) : 0,
      },
      change: { newCustomers: percentChange(newCustomers, previousNew ?? undefined) },
      series: fillSeries(period, signups.map((row) => ({ date: row._id as string, customers: row.customers as number })), { customers: 0 }),
      topCustomers: top.map((row) => ({ email: row._id as string, name: row.name as string, orders: row.orders as number, spent: round2(row.spent) })),
      byGroup: groups.map((row) => ({ name: row._id ? (groupNames.get(String(row._id)) ?? "Unknown group") : "No group", count: row.count as number })).sort((a, b) => b.count - a.count),
      bySignInMethod: methods.map((row) => ({ key: row._id as string, count: row.count as number })),
      guestVsRegistered: orderSplit.map((row) => ({ key: row._id as string, orders: row.orders as number, revenue: round2(row.revenue) })),
    };
  })
);

/* -------------------------------- Products -------------------------------- */

router.get(
  "/products",
  wrap(async (req) => {
    const period = await resolvePeriod(req);
    const match = { ...dateMatch(period), status: { $nin: EXCLUDED_FROM_REVENUE } };

    const [sold, byCategory, products, categories, settings] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            name: { $last: "$items.name" },
            thumbnail: { $last: "$items.thumbnail" },
            units: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.categoryId",
            units: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      Product.find().select("name thumbnail stock stockStatus price"),
      Category.find().select("name"),
      getSettings(),
    ]);

    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name as string]));
    const soldIds = new Set(sold.map((row) => row._id as string));
    const toRow = (row: (typeof sold)[number]) => ({
      productId: row._id as string,
      name: row.name as string,
      thumbnail: row.thumbnail as string,
      units: row.units as number,
      revenue: round2(row.revenue),
    });

    return {
      range: period.range,
      totals: {
        products: products.length,
        unitsSold: sold.reduce((sum, row) => sum + (row.units as number), 0),
        productsSold: sold.length,
        neverSold: products.filter((product) => !soldIds.has(String(product._id))).length,
        lowStock: products.filter((product) => product.stockStatus === "low-stock").length,
        outOfStock: products.filter((product) => product.stockStatus === "out-of-stock").length,
        lowStockThreshold: settings.store.lowStockThreshold,
      },
      topByUnits: [...sold].sort((a, b) => b.units - a.units).slice(0, 10).map(toRow),
      topByRevenue: [...sold].sort((a, b) => b.revenue - a.revenue).slice(0, 10).map(toRow),
      byCategory: mergeByName(
        byCategory.map((row) => ({
          categoryId: row._id as string,
          name: categoryNames.get(row._id as string) ?? "Deleted category",
          units: row.units as number,
          revenue: round2(row.revenue),
        })),
        (a, b) => ({ ...a, units: a.units + b.units, revenue: round2(a.revenue + b.revenue) })
      ).sort((a, b) => b.revenue - a.revenue),
      needsAttention: products
        .filter((product) => product.stockStatus !== "in-stock")
        .sort((a, b) => ((a.stock as number) ?? 0) - ((b.stock as number) ?? 0))
        .slice(0, 8)
        .map((product) => ({
          id: product.id as string,
          name: product.name as string,
          thumbnail: product.thumbnail as string,
          stock: (product.stock as number) ?? 0,
          stockStatus: product.stockStatus as string,
        })),
    };
  })
);

/* --------------------------------- Revenue --------------------------------- */

router.get(
  "/revenue",
  wrap(async (req) => {
    const period = await resolvePeriod(req);
    const match = { ...dateMatch(period), status: { $nin: EXCLUDED_FROM_REVENUE } };

    const [totals, previous, series, byCoupon, byCategory, categories] = await Promise.all([
      totalsFor(dateMatch(period)),
      previousTotals(period),
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: bucketFormat(period.granularity), date: "$createdAt" } },
            gross: { $sum: "$subtotal" },
            discounts: { $sum: "$discount" },
            net: { $sum: "$total" },
          },
        },
      ]),
      Order.aggregate([
        { $match: { ...match, couponCode: { $nin: [null, ""] } } },
        { $group: { _id: "$couponCode", orders: { $sum: 1 }, discount: { $sum: "$couponDiscount" }, revenue: { $sum: "$total" } } },
        { $sort: { revenue: -1 } },
        { $limit: 8 },
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: "$items" },
        { $group: { _id: "$items.categoryId", revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } } } },
        { $sort: { revenue: -1 } },
      ]),
      Category.find().select("name"),
    ]);

    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name as string]));

    return {
      range: period.range,
      granularity: period.granularity,
      totals,
      change: { revenue: percentChange(totals.revenue, previous?.revenue) },
      series: fillSeries(
        period,
        series.map((row) => ({ date: row._id as string, gross: round2(row.gross), discounts: round2(row.discounts), net: round2(row.net) })),
        { gross: 0, discounts: 0, net: 0 }
      ),
      byCoupon: byCoupon.map((row) => ({ code: row._id as string, orders: row.orders as number, discount: round2(row.discount ?? 0), revenue: round2(row.revenue) })),
      byCategory: mergeByName(
        byCategory.map((row) => ({ name: categoryNames.get(row._id as string) ?? "Deleted category", revenue: round2(row.revenue) })),
        (a, b) => ({ ...a, revenue: round2(a.revenue + b.revenue) })
      ).sort((a, b) => b.revenue - a.revenue),
    };
  })
);

export default router;
