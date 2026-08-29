import { Category } from "../../models/Category.js";

export interface CategoryNode {
  _id: string;
  name: string;
  type: string;
  color: string;
  bucket: string;
  budgetLimit: number;
  children: CategoryNode[];
}

export async function getCategoryTree(userId: string): Promise<CategoryNode[]> {
  const all = await Category.find({ userId }).lean();
  // Nodes keep every stored field (clients rely on `parentCategoryId`, `icon`, …), so
  // they're the lean document plus a stringified `_id` and a `children` array —
  // structurally a superset of `CategoryNode`, which is why the pushes below assert to
  // `CategoryNode` rather than the `any` this used to reach for.
  const byId = new Map(
    all.map((c) => [c._id.toString(), { ...c, _id: c._id.toString(), children: [] as CategoryNode[] }])
  );
  const roots: CategoryNode[] = [];

  for (const cat of byId.values()) {
    const node = cat as unknown as CategoryNode;
    if (cat.parentCategoryId) {
      const parent = byId.get(cat.parentCategoryId.toString());
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}
