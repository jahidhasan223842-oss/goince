// Staff roles for the admin panel.
// Roles: 'owner' (everything), 'manager' (shop + sales, no system settings),
// 'staff' (orders + products, view only).
// The admin `role` column lives on the `admins` table (default 'owner', so the
// existing admin@goince.com stays Owner). requireRole() enforces the rules in
// routes/admin.js; can() is the same check for views/nav.
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
  settings: ['owner'],
  paymentMethods: ['owner'],
  deliveryZones: ['owner'],
  staff: ['owner'],
  testEmail: ['owner'],
};

function getRole(req) {
  return (req.session && req.session.adminRole) || 'owner';
}

function can(role, area) {
  const allowed = AREA_ROLES[area] || [];
  return allowed.includes(role);
}

function requireRole(...areas) {
  return (req, res, next) => {
    const role = getRole(req);
    if (areas.some(area => can(role, area))) return next();
    return res.status(403).render('admin/no-access', { siteName: 'Goince', role });
  };
}

module.exports = { ROLES, AREA_ROLES, getRole, can, requireRole };
