import { CustomerGroup } from "../models/customer-group";
import { Customer } from "../models/customer";
import { Promotion } from "../models/promotion";
import { createCrudRouter } from "../utils/crud";

export default createCrudRouter({
  model: CustomerGroup,
  resource: "customer-groups",
  fields: { name: "string", description: "string", isActive: "boolean" },
  required: ["name"],
  sort: { name: 1 },

  decorateList: async (items) => {
    const counts = await Customer.aggregate([{ $match: { groupId: { $ne: null } } }, { $group: { _id: "$groupId", count: { $sum: 1 } } }]);
    const byGroup = new Map<string, number>(counts.map((row) => [String(row._id), row.count as number]));
    return items.map((item) => ({ ...item, memberCount: byGroup.get(String(item.id)) ?? 0 }));
  },

  // Deleting a group must not leave customers/promotions pointing at something that no longer exists.
  afterDelete: async (existing) => {
    const id = String(existing._id);
    await Customer.updateMany({ groupId: existing._id }, { groupId: null });
    await Promotion.updateMany({ customerGroupIds: id }, { $pull: { customerGroupIds: id } });
  },
});
