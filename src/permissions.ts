/**
 * The permission catalog. Every admin API route is guarded by one of these
 * keys (requireAdmin("orders.manage")), and every Role is just a named list
 * of them — so what a role can do is data (editable on the Roles/Permissions
 * pages), not hard-coded `if (role === ...)` checks scattered through routes.
 *
 * Two actions per resource: `view` (see private/admin-only data) and
 * `manage` (create / edit / delete). Public storefront reads need neither.
 */
export interface PermissionResource {
  key: string;
  label: string;
  group: string;
  actions: ("view" | "manage")[];
}

export const PERMISSION_RESOURCES: PermissionResource[] = [
  { key: "products", label: "Products", group: "Catalog", actions: ["view", "manage"] },
  { key: "categories", label: "Categories", group: "Catalog", actions: ["view", "manage"] },
  { key: "brands", label: "Brands", group: "Catalog", actions: ["view", "manage"] },
  { key: "attributes", label: "Attributes", group: "Catalog", actions: ["view", "manage"] },
  { key: "inventory", label: "Inventory", group: "Catalog", actions: ["view", "manage"] },
  { key: "orders", label: "Orders", group: "Orders", actions: ["view", "manage"] },
  { key: "customers", label: "Customers", group: "Customers", actions: ["view", "manage"] },
  { key: "customer-groups", label: "Customer Groups", group: "Customers", actions: ["view", "manage"] },
  { key: "reviews", label: "Reviews", group: "Customers", actions: ["view", "manage"] },
  { key: "coupons", label: "Coupons", group: "Marketing", actions: ["view", "manage"] },
  { key: "discounts", label: "Discounts", group: "Marketing", actions: ["view", "manage"] },
  { key: "campaigns", label: "Campaigns", group: "Marketing", actions: ["view", "manage"] },
  { key: "banners", label: "Banners", group: "Marketing", actions: ["view", "manage"] },
  { key: "promotions", label: "Promotions", group: "Marketing", actions: ["view", "manage"] },
  { key: "homepage", label: "Homepage", group: "Content", actions: ["view", "manage"] },
  { key: "pages", label: "Pages", group: "Content", actions: ["view", "manage"] },
  { key: "faq", label: "FAQ", group: "Content", actions: ["view", "manage"] },
  { key: "announcements", label: "Announcements", group: "Content", actions: ["view", "manage"] },
  { key: "analytics", label: "Analytics", group: "Analytics", actions: ["view"] },
  { key: "admin-users", label: "Admin Users", group: "Administration", actions: ["view", "manage"] },
  { key: "roles", label: "Roles & Permissions", group: "Administration", actions: ["view", "manage"] },
  { key: "settings", label: "Settings", group: "Settings", actions: ["view", "manage"] },
];

export interface PermissionDefinition {
  key: string;
  resource: string;
  action: "view" | "manage";
  label: string;
  group: string;
}

export const ALL_PERMISSIONS: PermissionDefinition[] = PERMISSION_RESOURCES.flatMap((resource) =>
  resource.actions.map((action) => ({
    key: `${resource.key}.${action}`,
    resource: resource.key,
    action,
    label: `${action === "view" ? "View" : "Manage"} ${resource.label.toLowerCase()}`,
    group: resource.group,
  }))
);

export const ALL_PERMISSION_KEYS = ALL_PERMISSIONS.map((permission) => permission.key);

export const SUPER_ADMIN_ROLE_KEY = "super-admin";

/** Permission that means "everything, including permissions added in the future". */
export const WILDCARD_PERMISSION = "*";

function everyone(resources: string[]): string[] {
  return ALL_PERMISSION_KEYS.filter((key) => resources.includes(key.split(".")[0]));
}

export interface DefaultRole {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

/**
 * Built-in roles. Seeded into the database (npm run seed:defaults) so admins
 * can tweak them, but also used as an in-code fallback so a role that hasn't
 * been seeded yet still resolves to sensible permissions instead of locking
 * everyone out.
 */
export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: SUPER_ADMIN_ROLE_KEY,
    name: "Super Admin",
    description: "Full access to everything, including admin users, roles and settings. Cannot be edited.",
    permissions: [WILDCARD_PERMISSION],
  },
  {
    key: "admin",
    name: "Admin",
    description: "Runs the store day to day. Everything except managing admin users and roles.",
    permissions: ALL_PERMISSION_KEYS.filter((key) => key !== "roles.manage" && key !== "admin-users.manage"),
  },
  {
    key: "manager",
    name: "Manager",
    description: "Catalog, orders, customers, marketing and content — without settings or administration.",
    permissions: [
      ...everyone([
        "products",
        "categories",
        "brands",
        "attributes",
        "inventory",
        "orders",
        "customers",
        "customer-groups",
        "reviews",
        "coupons",
        "discounts",
        "campaigns",
        "banners",
        "promotions",
        "homepage",
        "pages",
        "faq",
        "announcements",
        "analytics",
      ]),
    ],
  },
  {
    key: "order-manager",
    name: "Order Manager",
    description: "Processes orders and can look up customers, products and stock.",
    permissions: ["orders.view", "orders.manage", "customers.view", "products.view", "inventory.view"],
  },
  {
    key: "product-manager",
    name: "Product Manager",
    description: "Owns the catalog: products, categories, brands, attributes and inventory.",
    permissions: [...everyone(["products", "categories", "brands", "attributes", "inventory"]), "reviews.view"],
  },
  {
    key: "support-agent",
    name: "Support Agent",
    description: "Helps customers: sees orders and customers, moderates reviews, maintains the FAQ.",
    permissions: ["orders.view", "customers.view", "reviews.view", "reviews.manage", "faq.view", "faq.manage"],
  },
];

export function hasPermission(granted: string[], needed: string): boolean {
  return granted.includes(WILDCARD_PERMISSION) || granted.includes(needed);
}
