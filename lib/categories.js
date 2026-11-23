// Shared category-tree helpers — used by the admin routes and the shop.
// Categories nest without a depth limit (parent_id self-references), so the
// tree is built recursively from a flat list of rows. Each node gets:
//   children        — direct children, sorted by sort_order then id
//   depth           — 0 for a main category, 1 for its child, and so on
//   descendantIds   — every id below this node, at any depth
//   directProductCount / totalProductCount — products directly in this
//     category, and in this category plus all of its descendants
//   isOrphan        — true when parent_id points at a category that no
//     longer exists (can happen on older databases)
//
// HIDE RULE (documented here so admin + shop agree): a hidden category
// (is_visible = 0) is hidden from navigation AND its products are excluded
// from its parent's listing. A category is "effectively visible" only when
// it and every ancestor are visible. A hidden category is still reachable
// by its direct link (/?category=<id>) and its products stay reachable by
// direct product URL and search — hiding never deletes or unpublishes
// anything, it only removes the category from navigation and listings.

function sortCats(a, b) {
  return (a.sort_order - b.sort_order) || (a.id - b.id);
}

function buildCategoryTree(rows) {
  const byId = new Map();
  (rows || []).forEach((r) => {
    byId.set(r.id, {
      ...r,
      children: [],
      depth: 0,
      descendantIds: [],
      directProductCount: +(r.product_count || 0),
      totalProductCount: +(r.product_count || 0),
      isOrphan: false
    });
  });
  const roots = [];
  const orphans = [];
  byId.forEach((n) => {
    if (!n.parent_id) { roots.push(n); return; }
    const p = byId.get(n.parent_id);
    if (p) { p.children.push(n); n.depth = p.depth + 1; }
    else { n.isOrphan = true; roots.push(n); orphans.push(n); }
  });
  const sortSubtree = (n) => { n.children.sort(sortCats); n.children.forEach(sortSubtree); };
  roots.sort(sortCats);
  roots.forEach(sortSubtree);
  // Bottom-up (deepest first): descendant ids + product totals.
  const nodes = [...byId.values()].sort((a, b) => b.depth - a.depth);
  nodes.forEach((n) => {
    n.descendantIds = n.children.flatMap((c) => [c.id, ...c.descendantIds]);
    n.totalProductCount = n.directProductCount + n.children.reduce((s, c) => s + c.totalProductCount, 0);
  });
  return { roots, orphans, byId };
}

// Flat list in tree order (parent first, then its whole subtree), each node
// carrying its depth — used for indented <select> dropdowns.
function flattenTree(roots) {
  const out = [];
  const walk = (n) => { out.push(n); n.children.forEach(walk); };
  (roots || []).forEach(walk);
  return out;
}

// Ancestor chain from the topmost main category down to the node itself
// (includes the node). Used for the shop breadcrumb.
function ancestorChain(byId, id) {
  const chain = [];
  let cur = byId.get(+id);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return chain;
}

// Category ids to show when browsing a selected category on the shop:
// the selected category itself (even when hidden — a direct link still
// works), plus every descendant that is visible together with every node
// between it and the selected one. Hidden sub-trees never leak into a
// parent's listing.
function visibleSubtreeIds(byId, selectedId) {
  const sel = byId.get(+selectedId);
  if (!sel) return [];
  const ids = [sel.id];
  const walk = (n) => {
    n.children.forEach((c) => {
      if (c.is_visible !== 0) { ids.push(c.id); walk(c); }
    });
  };
  walk(sel);
  return ids;
}

// True when the category and every ancestor up to the main category are
// visible — the rule for showing a category in shop navigation.
function isEffectivelyVisible(byId, id) {
  let cur = byId.get(+id);
  if (!cur) return false;
  while (cur) {
    if (cur.is_visible === 0) return false;
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return true;
}

// Header mega menu tree: top-level categories a customer may navigate to,
// each with its whole visible subtree attached. Rules (same hide rule as
// the shop): a category appears only when it and every ancestor are
// visible, so a hidden category and its whole subtree are pruned. Roots
// come back featured-first, then sort_order (the shop's ordering); children
// keep buildCategoryTree's sort_order order. Nodes carry totalProductCount
// (own products + all descendants) for the count shown in the menu.
function buildMenuTree(rows) {
  const { roots, byId } = buildCategoryTree(rows);
  const prune = (n) => {
    n.children = n.children.filter((c) => isEffectivelyVisible(byId, c.id));
    n.children.forEach(prune);
  };
  const visibleRoots = roots.filter((r) => isEffectivelyVisible(byId, r.id));
  visibleRoots.forEach(prune);
  // Pruning-er por total gulo abar hisab korte hoy — buildCategoryTree
  // lukano category-r product-o total-e dhore felechilo, menu-te sei
  // number dekhale vul hobe.
  const recompute = (n) => {
    n.children.forEach(recompute);
    n.directProductCount = +(n.product_count || 0);
    n.totalProductCount = n.directProductCount + n.children.reduce((s, c) => s + c.totalProductCount, 0);
    n.descendantIds = n.children.flatMap((c) => [c.id, ...c.descendantIds]);
  };
  visibleRoots.forEach(recompute);
  visibleRoots.sort((a, b) => (b.is_featured - a.is_featured) || sortCats(a, b));
  return visibleRoots;
}

// Category-bar pill dropdown-er jonno: menu tree theke id diye node khujar
// flat map (node-er children/count soho). server.js middleware-e toiri hoy,
// index.ejs pill-er dropdown render korte eta use kore.
function buildMenuById(nodes) {
  const map = {};
  (function walk(list) {
    (list || []).forEach(n => {
      map[n.id] = n;
      if (n.children) walk(n.children);
    });
  })(nodes);
  return map;
}

module.exports = {
  buildCategoryTree,
  buildMenuTree,
  buildMenuById,
  flattenTree,
  ancestorChain,
  visibleSubtreeIds,
  isEffectivelyVisible
};
