// Central permission registry for the admin panel (fix/custom-roles-permissions).
//
// ONE SOURCE OF TRUTH: this list drives BOTH the route guards
// (requirePermission in lib/roles.js) AND the role editor UI
// (views/admin/role-form.ejs loops PERMISSION_GROUPS — never a hardcoded
// list in a view). Every admin capability is one entry here, grouped the
// same way as the sidebar (SHOP / SALES / COMMUNICATION / SYSTEM).
//
// CONVENTION — to add a new admin feature later:
//   1. Add ONE entry below (id, label, short description).
//   2. Guard its route with requirePermission('new.id').
//   3. Done — the role editor shows the new permission automatically, and
//      donal (the Owner) can allow or deny it per role. Do NOT hardcode
//      permissions in views or routes, and do NOT invent a second list.
//
// Safety: the Owner system role always gets EVERY permission in this file,
// including entries added later. Manager / Staff sets are frozen snapshots
// of what those roles could do before this system existed.
'use strict';

const PERMISSION_GROUPS = [
  {
    group: 'Shop',
    items: [
      { id: 'dashboard.view', label: 'Dashboard', desc: 'See the dashboard (sales, orders, revenue).' },
      { id: 'products.view', label: 'View products', desc: 'See the products list.' },
      { id: 'products.manage', label: 'Add / edit / delete products', desc: 'Add, edit, duplicate, import/export and delete products.' },
      { id: 'products.variants', label: 'Attributes & variants', desc: 'Manage attributes, variants, options and stock history.' },
      { id: 'categories.manage', label: 'Categories', desc: 'Add, edit, reorder, hide and delete categories.' },
      { id: 'banners.manage', label: 'Banners', desc: 'Manage homepage banners.' },
      { id: 'flash-offers.manage', label: 'Flash offers', desc: 'Create timed flash sales / offers with a countdown.' },
      { id: 'stock-alerts.manage', label: 'Stock alerts', desc: 'See stock alerts and mark them done.' },
      { id: 'inventory.manage', label: 'Inventory', desc: 'See and update inventory levels.' },
    ],
  },
  {
    group: 'Sales',
    items: [
      { id: 'orders.view', label: 'View orders', desc: 'See the orders list and order details, invoices and packing slips.' },
      { id: 'orders.manage', label: 'Change orders', desc: 'Change status, confirm by phone, collect COD, add notes, payments, shipping and courier.' },
      { id: 'activity.view', label: 'Calls & Activity', desc: 'See the phone confirmation queue and recent activity.' },
      { id: 'reports.view', label: 'Reports', desc: 'See sales reports and export them.' },
      { id: 'analytics.view', label: 'Analytics', desc: 'See the visitors / funnel / top-search analytics (real data only).' },
      { id: 'payment-methods.manage', label: 'Payment methods', desc: 'Add, edit and delete payment methods (bKash, Nagad, bank…).' },
      { id: 'delivery-zones.manage', label: 'Delivery zones', desc: 'Add, edit and delete delivery zones and charges.' },
      { id: 'customers.manage', label: 'Customers', desc: 'See, add, edit, block and delete customers.' },
      { id: 'coupons.manage', label: 'Coupons', desc: 'Add, toggle and delete coupons.' },
    ],
  },
  {
    group: 'Communication',
    items: [
      { id: 'reviews.manage', label: 'Review moderation', desc: 'Approve, hide and delete product reviews.' },
      { id: 'chats.manage', label: 'Live chat', desc: 'See live chats and reply to customers.' },
      { id: 'messages.manage', label: 'Contact messages', desc: 'See and delete contact messages.' },
      { id: 'campaigns.manage', label: 'Email campaigns & newsletter', desc: 'See newsletter subscribers and abandoned carts, compose and send email campaigns, run win-back offers.' },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'settings.manage', label: 'Settings', desc: 'Change shop settings (hero, footer, logo, delivery, gateway…).' },
      { id: 'backups.manage', label: 'Database backups', desc: 'See, run and download database backups (Admin > System > Backups).' },
      { id: 'audit.view', label: 'Audit log', desc: 'See the admin audit log (who changed what, when).' },
      { id: 'test-email.send', label: 'Test email', desc: 'Send a test email from Settings.' },
      { id: 'staff.manage', label: 'Staff & roles', desc: 'Add staff, change roles, create custom roles and edit permissions.' },
    ],
  },
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.id));
const ALL_SET = new Set(ALL_PERMISSIONS);

// What the 3 old fixed roles could do (PR #17, lib/roles.js AREA_ROLES),
// translated 1:1 into permission ids. These sets are frozen: a future
// registry entry is NOT added to Manager/Staff automatically — donal
// decides per role. Owner always gets ALL_PERMISSIONS (computed live).
const SYSTEM_ROLE_PERMISSIONS = {
  owner: ALL_PERMISSIONS.slice(),
  manager: [
    'dashboard.view',
    'products.view', 'products.manage', 'products.variants',
    'categories.manage', 'banners.manage', 'stock-alerts.manage', 'inventory.manage',
    'orders.view', 'orders.manage', 'activity.view', 'reports.view',
    'customers.manage', 'coupons.manage',
    'reviews.manage', 'chats.manage', 'messages.manage',
  ],
  staff: ['products.view', 'orders.view', 'activity.view'],
};

function isValidPermission(id) {
  return ALL_SET.has(id);
}

// Keep only real registry ids, de-duplicated, in registry order.
function filterPermissions(list) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(list) ? list : [list]) {
    if (typeof id === 'string' && ALL_SET.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// Strip every permission the saving admin does NOT have themselves.
// An Owner (granter has every permission) passes everything through.
function filterGrantable(requested, granterPermissions) {
  const valid = filterPermissions(requested);
  if (!Array.isArray(granterPermissions)) return [];
  const granter = new Set(granterPermissions);
  return valid.filter((id) => granter.has(id));
}

function parsePermissions(value) {
  if (Array.isArray(value)) return filterPermissions(value);
  if (typeof value === 'string') {
    try {
      return filterPermissions(JSON.parse(value));
    } catch (e) {
      return [];
    }
  }
  return [];
}

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  isValidPermission,
  filterPermissions,
  filterGrantable,
  parsePermissions,
};
