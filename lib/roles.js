// Staff roles for the admin panel.
// Roles: 'owner' (everything), 'manager' (shop + sales, no system settings),
// 'staff' (orders + products, view only).
// The admin `role` column lives on the `admins` table (default 'owner', so the
// existing admin@goince.com stays Owner). requireRole() enforces the rules in
// routes/admin.js; can() is the same check for views/nav.
//
// Custom roles (fix/custom-roles-permissions): donal can now create his own
// roles in Staff & Roles. The real permission list lives in
// lib/permissions.js (PERMISSION_GROUPS) — one source of truth for the route
// guards AND the role editor. Roles are stored in the `roles` table
// (permissions = JSON array); admins point at one with `admins.role_id`.
// Effective role: role_id if set, else the legacy `role` string.
// requirePermission() is the guard routes use now; requireRole() stays as a
// thin wrapper so old code keeps working.
const { ALL_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, parsePermissions } = require('./permissions');

const ROLES = ['owner', 'manager', 'staff'];

// Which roles may use each admin area.
const AREA_ROLES = {
  dashboard: ['owner', 'manager'],
  products: ['owner', 'manager'], // add/edit/delete/import/variants/attributes/...
  productsView: ['owner', 'manager', 'staff'], // GET /admin/products list only
  orders: ['owner', 'manager'], // changing an order (POST status/payment/shipping)
  ordersView: ['owner', 'manager', 'staff'], // GET /admin/orders + order details
  customers: ['owner', 'manager'],
  inventory: ['owner', 'manager'],
  coupons: ['owner', 'manager'],
  messages: ['owner', 'manager'],
  chats: ['owner', 'manager'],
  reports: ['owner', 'manager'],
  reviews: ['owner', 'manager'], // review moderation
  banners: ['owner', 'manager'], // homepage banner manager
  settings: ['owner'],
  paymentMethods: ['owner'],
  deliveryZones: ['owner'],
  staff: ['owner'],
  testEmail: ['owner'],
};

// Old area name -> permission id(s). Every requireRole('area') call maps to
// the same access via requirePermission() — the 3 system roles keep exactly
// the access they had before (verified by scripts/test-custom-roles-permissions.js).
const AREA_TO_PERMISSIONS = {
  dashboard: ['dashboard.view'],
  products: ['products.manage'],
  productsView: ['products.view'],
  orders: ['orders.manage'],
  ordersView: ['orders.view'],
  customers: ['customers.manage'],
  inventory: ['inventory.manage'],
  coupons: ['coupons.manage'],
  messages: ['messages.manage'],
  chats: ['chats.manage'],
  reports: ['reports.view'],
  reviews: ['reviews.manage'],
  banners: ['banners.manage'],
  settings: ['settings.manage'],
  paymentMethods: ['payment-methods.manage'],
  deliveryZones: ['delivery-zones.manage'],
  staff: ['staff.manage'],
  testEmail: ['test-email.send'],
};

function getRole(req) {
  return (req.session && req.session.adminRole) || 'owner';
}

// Permissions of the signed-in admin, from the session (set at login).
// Falls back to the legacy role string so an old session (from before this
// deploy) still enforces the right access.
function getPermissions(req) {
  if (req.session && Array.isArray(req.session.adminPermissions)) {
    return req.session.adminPermissions;
  }
  const role = (getRole(req) || 'owner').toLowerCase();
  return SYSTEM_ROLE_PERMISSIONS[role] || SYSTEM_ROLE_PERMISSIONS.staff;
}

function hasPermission(req, perm) {
  return getPermissions(req).includes(perm);
}

function can(role, area) {
  const allowed = AREA_ROLES[area] || [];
  return allowed.includes(role);
}

// Guard: allow when the admin has ANY of the listed permissions.
function requirePermission(...perms) {
  return (req, res, next) => {
    if (perms.some((perm) => hasPermission(req, perm))) return next();
    return res.status(403).render('admin/no-access', { siteName: 'Goince', role: getRole(req) });
  };
}

function requireRole(...areas) {
  const perms = areas.flatMap((area) => AREA_TO_PERMISSIONS[area] || []);
  return requirePermission(...perms);
}

// Resolve an admin row to its effective role + permission list.
// role_id (custom or system role row) wins; otherwise the legacy `role`
// string maps to the frozen system set. Owner always gets ALL_PERMISSIONS,
// including registry entries added later. Never throws — on any DB problem
// it falls back to the legacy role string.
async function resolveAdminPermissions(db, adminRow) {
  const cap = (s) => String(s || 'staff').charAt(0).toUpperCase() + String(s || 'staff').slice(1).toLowerCase();
  if (!adminRow) {
    return { roleName: 'Owner', roleId: null, permissions: ALL_PERMISSIONS.slice(), isOwner: true };
  }
  const legacy = String(adminRow.role || 'owner').toLowerCase();
  const legacyFallback = () => ({
    roleName: cap(legacy),
    roleId: null,
    permissions: (SYSTEM_ROLE_PERMISSIONS[legacy] || SYSTEM_ROLE_PERMISSIONS.staff).slice(),
    isOwner: legacy === 'owner',
  });
  try {
    if (adminRow.role_id) {
      const [rows] = await db.query('SELECT * FROM roles WHERE id = ?', [adminRow.role_id]);
      if (rows && rows[0]) {
        const isOwner = rows[0].is_system === 1 && rows[0].name === 'Owner';
        return {
          roleName: rows[0].name,
          roleId: rows[0].id,
          permissions: isOwner ? ALL_PERMISSIONS.slice() : parsePermissions(rows[0].permissions),
          isOwner,
        };
      }
    }
    // No role_id (or dangling one): prefer the seeded system role row so the
    // DB and the code agree, else the frozen in-code set.
    const [srows] = await db.query('SELECT * FROM roles WHERE name = ? AND is_system = 1', [cap(legacy)]);
    if (srows && srows[0]) {
      const isOwner = legacy === 'owner';
      return {
        roleName: srows[0].name,
        roleId: srows[0].id,
        permissions: isOwner ? ALL_PERMISSIONS.slice() : parsePermissions(srows[0].permissions),
        isOwner,
      };
    }
    return legacyFallback();
  } catch (err) {
    return legacyFallback();
  }
}

module.exports = {
  ROLES, AREA_ROLES, AREA_TO_PERMISSIONS, getRole, getPermissions,
  hasPermission, can, requireRole, requirePermission, resolveAdminPermissions,
};
