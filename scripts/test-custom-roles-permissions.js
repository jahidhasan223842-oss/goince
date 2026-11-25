// Custom roles & permissions (fix/custom-roles-permissions) — unit + stubbed-DB test.
//
// Donal can now create his own roles in Staff & Roles, tick exactly which
// features each role can use, and assign staff to them. The permission list
// lives in lib/permissions.js (one source of truth for the route guards AND
// the role editor), so a future feature added to the registry appears in the
// editor automatically.
//
// No live MySQL needed: config/db is stubbed in the require cache with
// in-memory roles/admins stores, the real server.js + routers + EJS render
// over real HTTP on a throwaway port.
// Checks:
//   1. Unit: the 3 system roles resolve to EXACTLY the access the old fixed
//      roles had (AREA_ROLES, PR #17), translated to permission ids.
//   2. Unit: registry invariants — unique ids, every id used by a route is
//      a real registry id, filterGrantable strips permissions the saver lacks.
//   3. HTTP: owner/manager/staff keep exactly today's access (allowed routes
//      200, denied routes 403); a custom role (orders view only) can open
//      Orders + Activity but gets 403 on Products, Dashboard and order
//      status changes; a legacy admin with no role_id still resolves via
//      the old role string.
//   4. HTTP: creating a role via POST saves the permission JSON (bogus ids
//      stripped) and the editor then renders it; deleting a role in use is
//      blocked, deleting an unused custom role works; system roles are
//      view-only (edit POST blocked); the last-Owner guard blocks a
//      non-owner role-manager from demoting the only Owner; an admin cannot
//      grant a permission they lack (stripped on save).
//   5. HTTP: the sidebar hides menu items the signed-in admin has no
//      permission for; the role editor renders EVERY registry permission.
//   6. Direct EJS: roles list, role form (add/edit/read-only), staff page
//      with role dropdowns, products list + order details with view-only
//      permissions (no edit/status buttons).
//   7. Source: no requireRole( call remains in routes/admin.js; the role
//      editor loops PERMISSION_GROUPS (no hardcoded permission id in the
//      view); CSS has the 44px permission rows.
//
// Run:  node scripts/test-custom-roles-permissions.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const util = require('util');
const ejs = require('ejs');
const bcrypt = require('bcryptjs');

const PORT = process.env.TEST_PORT || '3464';
process.env.PORT = PORT;
process.env.SESSION_SECRET = 'test-secret-for-custom-roles';

const { PERMISSION_GROUPS, ALL_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, filterGrantable, parsePermissions } = require('../lib/permissions');
const { AREA_ROLES } = require('../lib/roles');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function has(html, needle) { return html.includes(needle); }

// ---------- (1) unit: system sets == old AREA_ROLES, translated ----------
// Old area -> permission ids (the same mapping lib/roles.js AREA_TO_PERMISSIONS uses).
const AREA_TO_PERMS = {
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
// Granular permissions the old 'products' area covered as one block.
const PRODUCTS_BLOCK = ['products.manage', 'products.variants', 'categories.manage', 'banners.manage', 'stock-alerts.manage', 'inventory.manage'];

function expectedSet(roleName) {
  const out = new Set();
  for (const [area, roles] of Object.entries(AREA_ROLES)) {
    if (!roles.includes(roleName)) continue;
    for (const perm of (AREA_TO_PERMS[area] || [])) {
      if (perm === 'products.manage') PRODUCTS_BLOCK.forEach((p) => out.add(p));
      else out.add(perm);
    }
  }
  // ordersView also opens the Calls & Activity page (same area in practice).
  if (AREA_ROLES.ordersView.includes(roleName)) out.add('activity.view');
  return out;
}

console.log('Unit (system roles == old access)');
for (const roleName of ['owner', 'manager', 'staff']) {
  const got = new Set(SYSTEM_ROLE_PERMISSIONS[roleName]);
  const want = expectedSet(roleName);
  const missing = [...want].filter((p) => !got.has(p));
  const extra = [...got].filter((p) => !want.has(p));
  check(`system role ${roleName} matches old access (${got.size} perms)`,
    missing.length === 0 && extra.length === 0,
    `missing: ${missing.join(',')} extra: ${extra.join(',')}`);
}
check('owner has every registry permission',
  SYSTEM_ROLE_PERMISSIONS.owner.length === ALL_PERMISSIONS.length
  && ALL_PERMISSIONS.every((p) => SYSTEM_ROLE_PERMISSIONS.owner.includes(p)));

console.log('Unit (registry invariants)');
check('all permission ids unique', new Set(ALL_PERMISSIONS).size === ALL_PERMISSIONS.length, String(ALL_PERMISSIONS.length));
check('registry has 22 permissions', ALL_PERMISSIONS.length === 22, String(ALL_PERMISSIONS.length));
check('every group has at least one item', PERMISSION_GROUPS.every((g) => g.items.length > 0));
check('filterGrantable strips permissions the saver lacks',
  JSON.stringify(filterGrantable(['orders.view', 'settings.manage', 'bogus.perm'], ['orders.view'])) === JSON.stringify(['orders.view']));
check('filterGrantable passes everything for an owner',
  filterGrantable(['orders.view', 'settings.manage'], ALL_PERMISSIONS).length === 2);
check('parsePermissions drops unknown ids', JSON.stringify(parsePermissions('["orders.view","nope"]')) === JSON.stringify(['orders.view']));

// ---------- fixture stores ----------
const ADMIN_PASSWORD = 'admin123';
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 8);
const now = new Date();

let rolesStore = [
  { id: 1, name: 'Owner', description: 'Everything — the shop owner.', permissions: JSON.stringify(SYSTEM_ROLE_PERMISSIONS.owner), is_system: 1, created_at: now },
  { id: 2, name: 'Manager', description: 'Products, orders, customers and inventory.', permissions: JSON.stringify(SYSTEM_ROLE_PERMISSIONS.manager), is_system: 1, created_at: now },
  { id: 3, name: 'Staff', description: 'Orders + products, view only.', permissions: JSON.stringify(SYSTEM_ROLE_PERMISSIONS.staff), is_system: 1, created_at: now },
  { id: 4, name: 'Order Handler', description: 'Orders only.', permissions: JSON.stringify(['orders.view', 'activity.view']), is_system: 0, created_at: now },
  { id: 5, name: 'Role Manager', description: 'Can manage staff and roles.', permissions: JSON.stringify(['staff.manage', 'orders.view']), is_system: 0, created_at: now },
];
let adminsStore = [
  { id: 1, email: 'admin@goince.com', password: adminHash, role: 'owner', role_id: 1, created_at: now },
  { id: 2, email: 'manager@goince.com', password: adminHash, role: 'manager', role_id: 2, created_at: now },
  { id: 3, email: 'staff@goince.com', password: adminHash, role: 'staff', role_id: 3, created_at: now },
  { id: 4, email: 'handler@goince.com', password: adminHash, role: 'staff', role_id: 4, created_at: now },
  { id: 5, email: 'rolemgr@goince.com', password: adminHash, role: 'staff', role_id: 5, created_at: now },
  { id: 6, email: 'legacy@goince.com', password: adminHash, role: 'manager', role_id: null, created_at: now },
];
let nextRoleId = 6;
let nextAdminId = 7;

function effectiveOwnerCount() {
  return adminsStore.filter((a) => {
    if (a.role_id) {
      const r = rolesStore.find((x) => x.id === a.role_id);
      return r && r.is_system === 1 && r.name === 'Owner';
    }
    return a.role === 'owner';
  }).length;
}
function effectiveRoleRow(admin) {
  if (admin.role_id) {
    const r = rolesStore.find((x) => x.id === admin.role_id);
    return { id: admin.id, role: admin.role, role_id: admin.role_id, role_name: r ? r.name : null, is_system: r ? r.is_system : 0 };
  }
  return { id: admin.id, role: admin.role, role_id: null, role_name: null, is_system: 0 };
}

const orderRows = [
  { id: 1, customer_name: 'Buyer One', phone: '01810000001', email: '', address: 'Dhaka', delivery_zone: 'Inside Dhaka', delivery_charge: 60, status: 'Pending', payment_method: 'Cash on Delivery', payment_status: 'Unpaid', total_amount: 370, discount_amount: 0, coupon_code: '', created_at: now, phone_confirmed: 0, phone_confirmed_at: null, cod_collected: 0, cod_collected_at: null, cancel_reason: '', transaction_id: '', courier_name: '', courier_status: '', courier_consignment_id: '', tracking_number: '' },
  { id: 2, customer_name: 'Buyer Two', phone: '01810000002', email: '', address: 'Chittagong', delivery_zone: 'Outside Dhaka', delivery_charge: 120, status: 'Delivered', payment_method: 'Cash on Delivery', payment_status: 'Paid', total_amount: 990, discount_amount: 0, coupon_code: '', created_at: now, phone_confirmed: 1, phone_confirmed_at: now, cod_collected: 1, cod_collected_at: now, cancel_reason: '', transaction_id: '', courier_name: '', courier_status: '', courier_consignment_id: '', tracking_number: '' },
];

function rowsFor(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ');
  const p = params || [];
  // --- global middleware (server.js) ---
  if (s.includes("setting_key = 'shop_phone'")) return [{ setting_value: '' }];
  if (s.includes('FROM settings WHERE setting_key IN')) return [];
  if (s.includes('COUNT(products.id) AS product_count')) return [];
  // --- startup content fixes ---
  if (s.startsWith('UPDATE settings SET setting_value') || s.startsWith('UPDATE products SET name')) return [{ affectedRows: 0 }];
  // --- startup: delivery zones seed check ---
  if (s.includes('zoneCount')) return [{ zoneCount: 1 }];
  if (s === 'SELECT COUNT(*) AS cnt FROM admins') return [{ cnt: adminsStore.length }];
  // --- startup: custom roles table ---
  if (s.includes("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS") && s.includes("TABLE_NAME = 'admins'")) {
    return [{ COLUMN_NAME: 'role' }, { COLUMN_NAME: 'role_id' }];
  }
  if (s.includes('SELECT id, name FROM roles WHERE is_system = 1')) return rolesStore.filter((r) => r.is_system === 1).map((r) => ({ id: r.id, name: r.name }));
  if (s.includes('SELECT id, role FROM admins WHERE role_id IS NULL')) return [];
  if (s.startsWith('CREATE TABLE IF NOT EXISTS roles') || s.startsWith('ALTER TABLE admins ADD COLUMN role_id')) return [];
  // --- admin login ---
  if (s.includes('FROM admins WHERE email = ?')) {
    const a = adminsStore.find((x) => x.email === p[0]);
    return a ? [{ ...a }] : [];
  }
  // --- role resolution (login + systemRoleId) ---
  if (s.includes('SELECT * FROM roles WHERE id = ?')) {
    const r = rolesStore.find((x) => String(x.id) === String(p[0]));
    return r ? [{ ...r }] : [];
  }
  if (s.includes('SELECT * FROM roles WHERE name = ? AND is_system = 1')) {
    const r = rolesStore.find((x) => x.name === p[0] && x.is_system === 1);
    return r ? [{ ...r }] : [];
  }
  if (s.includes('SELECT id FROM roles WHERE name = ? AND is_system = 1')) {
    const r = rolesStore.find((x) => x.name === p[0] && x.is_system === 1);
    return r ? [{ id: r.id }] : [];
  }
  // --- staff page ---
  if (s.includes('SELECT id, email, role, role_id, created_at FROM admins ORDER BY id ASC')) {
    return adminsStore.map((a) => ({ id: a.id, email: a.email, role: a.role, role_id: a.role_id, created_at: a.created_at }));
  }
  if (s.includes('SELECT id, name, description, is_system FROM roles ORDER BY')) {
    return rolesStore.map((r) => ({ id: r.id, name: r.name, description: r.description, is_system: r.is_system }));
  }
  // --- effective role / owner count helpers ---
  if (s.includes('FROM admins a LEFT JOIN roles r ON r.id = a.role_id WHERE a.id = ?')) {
    const a = adminsStore.find((x) => String(x.id) === String(p[0]));
    return a ? [effectiveRoleRow(a)] : [];
  }
  if (s.includes("SELECT COUNT(*) AS cnt FROM admins a LEFT JOIN roles r")) return [{ cnt: effectiveOwnerCount() }];
  if (s.includes('UPDATE admins SET role = ?, role_id = ? WHERE id = ?')) {
    const a = adminsStore.find((x) => String(x.id) === String(p[2]));
    if (a) { a.role = p[0]; a.role_id = p[1]; }
    return [{ affectedRows: a ? 1 : 0 }];
  }
  if (s.includes('INSERT INTO admins (email, password, role, role_id)')) {
    adminsStore.push({ id: nextAdminId++, email: p[0], password: p[1], role: p[2], role_id: p[3], created_at: now });
    return [{ insertId: nextAdminId - 1 }];
  }
  if (s.includes('UPDATE admins SET password = ? WHERE id = ?')) {
    const a = adminsStore.find((x) => String(x.id) === String(p[1]));
    if (a) a.password = p[0];
    return [{ affectedRows: a ? 1 : 0 }];
  }
  if (s.includes('DELETE FROM admins WHERE id = ?')) {
    const i = adminsStore.findIndex((x) => String(x.id) === String(p[0]));
    if (i >= 0) adminsStore.splice(i, 1);
    return [{ affectedRows: i >= 0 ? 1 : 0 }];
  }
  // --- roles list / load / save / delete ---
  if (s.includes('SELECT r.*, COUNT(a.id) AS member_count FROM roles r LEFT JOIN admins a')) {
    return rolesStore.map((r) => ({ ...r, member_count: adminsStore.filter((a) => a.role_id === r.id).length }));
  }
  if (s.includes('SELECT id FROM roles WHERE name = ? AND id != ?')) {
    const r = rolesStore.find((x) => x.name === p[0] && String(x.id) !== String(p[1]));
    return r ? [{ id: r.id }] : [];
  }
  if (s.includes('SELECT id FROM roles WHERE name = ?')) {
    const r = rolesStore.find((x) => x.name === p[0]);
    return r ? [{ id: r.id }] : [];
  }
  if (s.includes('INSERT INTO roles (name, description, permissions, is_system)')) {
    rolesStore.push({ id: nextRoleId, name: p[0], description: p[1], permissions: p[2], is_system: 0, created_at: now });
    return [{ insertId: nextRoleId++ }];
  }
  if (s.includes('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?')) {
    const r = rolesStore.find((x) => String(x.id) === String(p[3]));
    if (r) { r.name = p[0]; r.description = p[1]; r.permissions = p[2]; }
    return [{ affectedRows: r ? 1 : 0 }];
  }
  if (s.includes('SELECT COUNT(*) AS cnt FROM admins WHERE role_id = ?')) {
    return [{ cnt: adminsStore.filter((a) => String(a.role_id) === String(p[0])).length }];
  }
  if (s.includes('DELETE FROM roles WHERE id = ?')) {
    const i = rolesStore.findIndex((x) => String(x.id) === String(p[0]));
    if (i >= 0) rolesStore.splice(i, 1);
    return [{ affectedRows: i >= 0 ? 1 : 0 }];
  }
  // --- invoices (orders list) ---
  if (s.includes('SELECT status, COUNT(*) AS count FROM orders GROUP BY status')) {
    return [{ status: 'Pending', count: 1 }, { status: 'Delivered', count: 1 }];
  }
  if (s.startsWith('SELECT COUNT(*) AS cnt FROM orders')) return [{ cnt: orderRows.length }];
  if (s.includes('SELECT * FROM orders') && s.includes('ORDER BY created_at DESC LIMIT ? OFFSET ?')) return orderRows.slice(p[p.length - 1], p[p.length - 1] + p[p.length - 2]);
  if (s.includes('FROM order_payments GROUP BY order_id')) return [];
  // --- products list ---
  if (s.includes('FROM products p')) return [];
  if (s.includes('SELECT id, name, parent_id, sort_order FROM categories')) return [];
  // --- coupons ---
  if (s.includes('SELECT * FROM coupons ORDER BY created_at DESC')) return [];
  // --- activity (minimal fixture) ---
  if (s.includes('phone_confirmed') && s.includes('COUNT(*)')) return [{ c: 1 }];
  if (s.includes('phone_confirmed') && s.includes('LIMIT ? OFFSET ?')) return [orderRows[0]];
  if (s.includes('order_status_history') && s.includes('COUNT(*)')) return [{ c: 0 }];
  if (s === 'SELECT COUNT(*) AS c FROM orders') return [{ c: 0 }];
  if (s.includes('FROM order_status_history ORDER BY created_at DESC')) return [];
  if (s.includes('FROM orders') && s.includes('ORDER BY created_at DESC, id DESC LIMIT ?')) return [];
  // --- anything else: empty result (safe default) ---
  return [];
}

const stubDb = {
  query: async (sql, params) => [rowsFor(sql, params)],
  execute: async (sql, params) => [rowsFor(sql, params)],
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (typeof request === 'string' && /(^|\/)config\/db$/.test(request.replace(/\\/g, '/'))) {
    return stubDb;
  }
  return originalLoad.apply(this, arguments);
};

// The real server (listens on PORT as a side effect of being required).
require('../server.js');

const jar = {};
function storeCookies(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}
function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
function clearJar() { for (const k of Object.keys(jar)) delete jar[k]; }
async function get(pathname) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    headers: cookieHeader() ? { Cookie: cookieHeader() } : {},
    redirect: 'manual',
  });
  storeCookies(res);
  return { status: res.status, headers: res.headers, text: await res.text() };
}
async function postForm(pathname, fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => body.append(k, x));
    else body.append(k, v);
  }
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
    },
    body: body.toString(),
    redirect: 'manual',
  });
  storeCookies(res);
  return { status: res.status, headers: res.headers, text: await res.text() };
}
async function loginAs(email) {
  clearJar();
  const login = await get('/admin/login');
  const csrf = (login.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const res = await postForm('/admin/login', { email, password: ADMIN_PASSWORD, _csrf: csrf || '' });
  return res;
}
async function csrfFrom(pathname) {
  const page = await get(pathname);
  return { page, csrf: (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
}
async function waitForServer(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`, { redirect: 'manual' });
      await res.text();
      return true;
    } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
  }
  return false;
}
function roleByName(name) { return rolesStore.find((r) => r.name === name); }

(async () => {
  console.log('HTTP (stubbed DB, real server)');
  if (!(await waitForServer())) {
    console.log('FAIL  server did not start');
    process.exit(1);
  }

  // (3a) Owner keeps everything.
  const ownerLogin = await loginAs('admin@goince.com');
  check('owner login redirects (dashboard landing)', ownerLogin.status === 302 && String(ownerLogin.headers.get('location') || '').includes('/admin/dashboard'), 'got ' + ownerLogin.status + ' -> ' + ownerLogin.headers.get('location'));
  const ownerRoles = await get('/admin/roles');
  check('owner can open /admin/roles', ownerRoles.status === 200, 'got ' + ownerRoles.status);
  check('roles list shows all 5 fixture roles', ['Owner', 'Manager', 'Staff', 'Order Handler', 'Role Manager'].every((n) => has(ownerRoles.text, n)));
  check('roles list marks system roles', has(ownerRoles.text, 'System role'));
  check('roles list marks custom roles', has(ownerRoles.text, 'Custom role'));
  const ownerStaff = await get('/admin/staff');
  check('owner can open /admin/staff', ownerStaff.status === 200, 'got ' + ownerStaff.status);
  check('staff page lists the custom role in the dropdown', has(ownerStaff.text, 'value="role:4"') && has(ownerStaff.text, 'Order Handler'));

  // (4a) Create a role via POST; bogus ids stripped, then the editor renders it.
  const addForm = await csrfFrom('/admin/roles/add');
  check('role add form renders 200', addForm.page.status === 200, 'got ' + addForm.page.status);
  check('role editor renders EVERY registry permission',
    ALL_PERMISSIONS.every((id) => has(addForm.page.text, `value="${id}"`)),
    'missing: ' + ALL_PERMISSIONS.filter((id) => !has(addForm.page.text, `value="${id}"`)).join(','));
  const addRes = await postForm('/admin/roles/add', { name: 'Packer', description: 'Packs orders.', permissions: ['orders.view', 'bogus.perm'], _csrf: addForm.csrf });
  check('creating a role redirects to /admin/roles', addRes.status === 302 && String(addRes.headers.get('location') || '').includes('/admin/roles'), 'got ' + addRes.status + ' -> ' + addRes.headers.get('location'));
  const packer = roleByName('Packer');
  check('Packer role was saved', !!packer, 'not in store');
  check('bogus permission id was stripped on save',
    packer && JSON.stringify(parsePermissions(packer.permissions)) === JSON.stringify(['orders.view']),
    packer ? packer.permissions : 'no role');
  const packerEdit = await get('/admin/roles/edit/' + (packer ? packer.id : 999));
  check('editor renders the saved role with orders.view checked',
    packerEdit.status === 200 && has(packerEdit.text, 'value="orders.view" checked'), 'got ' + packerEdit.status);

  // (4b) Delete: in-use blocked, unused works.
  const delInUse = await postForm('/admin/roles/delete/4', { _csrf: (await csrfFrom('/admin/roles')).csrf });
  check('deleting a role in use is blocked',
    delInUse.status === 302 && String(delInUse.headers.get('location') || '').includes('err='),
    'got ' + delInUse.status + ' -> ' + delInUse.headers.get('location'));
  check('in-use role still exists after blocked delete', !!roleByName('Order Handler'));
  const delPacker = await postForm('/admin/roles/delete/' + packer.id, { _csrf: (await csrfFrom('/admin/roles')).csrf });
  check('deleting an unused custom role works',
    delPacker.status === 302 && String(delPacker.headers.get('location') || '').includes('msg='),
    'got ' + delPacker.status + ' -> ' + delPacker.headers.get('location'));
  check('deleted role is gone', !roleByName('Packer'));

  // (4c) System roles are view-only.
  const sysEdit = await get('/admin/roles/edit/1');
  check('system role edit page is read-only',
    sysEdit.status === 200 && has(sysEdit.text, 'System roles cannot be edited') && has(sysEdit.text, 'disabled'),
    'got ' + sysEdit.status);
  const sysEditPost = await postForm('/admin/roles/edit/1', { name: 'Owner', permissions: [], _csrf: (await csrfFrom('/admin/roles/edit/1')).csrf });
  check('editing a system role via POST is blocked',
    sysEditPost.status === 302 && String(sysEditPost.headers.get('location') || '').includes('err='),
    'got ' + sysEditPost.status + ' -> ' + sysEditPost.headers.get('location'));

  // (4d) A non-owner role-manager cannot demote the only Owner (last-Owner guard).
  const mgrLogin = await loginAs('rolemgr@goince.com');
  check('role-manager login redirects (orders landing — no dashboard.view)',
    mgrLogin.status === 302 && String(mgrLogin.headers.get('location') || '').includes('/admin/orders'),
    'got ' + mgrLogin.status + ' -> ' + mgrLogin.headers.get('location'));
  const demote = await postForm('/admin/staff/1/role', { role: 'role:3', _csrf: (await csrfFrom('/admin/staff')).csrf });
  check('demoting the only Owner is blocked',
    demote.status === 302 && String(demote.headers.get('location') || '').includes('err='),
    'got ' + demote.status + ' -> ' + demote.headers.get('location'));
  check('the Owner is still the Owner after the blocked demote',
    adminsStore.find((a) => a.id === 1).role_id === 1);

  // (4e) A non-owner cannot grant a permission they lack (stripped on save).
  const grantForm = await csrfFrom('/admin/roles/add');
  const grantRes = await postForm('/admin/roles/add', {
    name: 'Sneaky', permissions: ['staff.manage', 'orders.view', 'settings.manage'], _csrf: grantForm.csrf,
  });
  check('role-manager can create a role', grantRes.status === 302 && String(grantRes.headers.get('location') || '').includes('/admin/roles'), 'got ' + grantRes.status);
  const sneaky = roleByName('Sneaky');
  check('settings.manage was stripped (saver lacks it)',
    sneaky && !parsePermissions(sneaky.permissions).includes('settings.manage'),
    sneaky ? sneaky.permissions : 'no role');
  check('permissions the saver HAS were kept',
    sneaky && parsePermissions(sneaky.permissions).includes('staff.manage') && parsePermissions(sneaky.permissions).includes('orders.view'),
    sneaky ? sneaky.permissions : 'no role');
  await postForm('/admin/roles/delete/' + sneaky.id, { _csrf: (await csrfFrom('/admin/roles')).csrf });

  // (3b) Move the Order Handler off role 4, then the role can be deleted.
  await loginAs('admin@goince.com');
  const move = await postForm('/admin/staff/4/role', { role: 'role:3', _csrf: (await csrfFrom('/admin/staff')).csrf });
  check('owner can move a staff member to another role',
    move.status === 302 && String(move.headers.get('location') || '').includes('msg='),
    'got ' + move.status + ' -> ' + move.headers.get('location'));
  check('handler now has the Staff role', adminsStore.find((a) => a.id === 4).role_id === 3);
  const delFree = await postForm('/admin/roles/delete/4', { _csrf: (await csrfFrom('/admin/roles')).csrf });
  check('role freed from staff can now be deleted',
    delFree.status === 302 && String(delFree.headers.get('location') || '').includes('msg='),
    'got ' + delFree.status + ' -> ' + delFree.headers.get('location'));
  check('Order Handler role is gone', !roleByName('Order Handler'));

  // (3c) Staff keeps exactly today's access.
  await loginAs('staff@goince.com');
  const staffInvoices = await get('/admin/invoices');
  check('staff can open Orders (orders.view)', staffInvoices.status === 200, 'got ' + staffInvoices.status);
  check('staff sidebar shows Orders + Activity + Products',
    has(staffInvoices.text, '/admin/invoices') && has(staffInvoices.text, '/admin/activity') && has(staffInvoices.text, '/admin/products'));
  check('staff sidebar hides Dashboard / Settings / Staff / Reports',
    !has(staffInvoices.text, '/admin/dashboard') && !has(staffInvoices.text, '/admin/settings')
    && !has(staffInvoices.text, '/admin/staff') && !has(staffInvoices.text, '/admin/reports'));
  const staffDash = await get('/admin/dashboard');
  check('staff cannot open the dashboard (403)', staffDash.status === 403, 'got ' + staffDash.status);
  const staffSettings = await get('/admin/settings');
  check('staff cannot open settings (403)', staffSettings.status === 403, 'got ' + staffSettings.status);
  const staffAdd = await get('/admin/products/add');
  check('staff cannot open Add Product (403)', staffAdd.status === 403, 'got ' + staffAdd.status);
  const staffProducts = await get('/admin/products');
  check('staff can open the products list (200)', staffProducts.status === 200, 'got ' + staffProducts.status);
  const staffActivity = await get('/admin/activity');
  check('staff can open Calls & Activity (200)', staffActivity.status === 200, 'got ' + staffActivity.status);

  // (3d) A custom role with orders view only: Orders yes, Products/Dashboard/status no.
  const handlerAdd = await (async () => {
    await loginAs('admin@goince.com');
    const f = await csrfFrom('/admin/roles/add');
    await postForm('/admin/roles/add', { name: 'Orders Only', permissions: ['orders.view', 'activity.view'], _csrf: f.csrf });
    const r = roleByName('Orders Only');
    const sf = await csrfFrom('/admin/staff');
    return postForm('/admin/staff/4/role', { role: 'role:' + r.id, _csrf: sf.csrf });
  })();
  check('owner assigned the orders-only role to the handler', handlerAdd.status === 302, 'got ' + handlerAdd.status);
  await loginAs('handler@goince.com');
  const hInvoices = await get('/admin/invoices');
  check('orders-only role can open Orders', hInvoices.status === 200, 'got ' + hInvoices.status);
  check('orders-only sidebar hides Products and Dashboard',
    !has(hInvoices.text, '/admin/products') && !has(hInvoices.text, '/admin/dashboard'));
  const hActivity = await get('/admin/activity');
  check('orders-only role can open Activity', hActivity.status === 200, 'got ' + hActivity.status);
  const hProducts = await get('/admin/products');
  check('orders-only role cannot open Products (403)', hProducts.status === 403, 'got ' + hProducts.status);
  const hDash = await get('/admin/dashboard');
  check('orders-only role cannot open the dashboard (403)', hDash.status === 403, 'got ' + hDash.status);
  const hStatus = await postForm('/admin/orders/1/status', { status: 'Confirmed', _csrf: (await csrfFrom('/admin/invoices')).csrf });
  check('orders-only role cannot change an order status (403)', hStatus.status === 403, 'got ' + hStatus.status);

  // (3e) Manager keeps today's access.
  await loginAs('manager@goince.com');
  const mInvoices = await get('/admin/invoices');
  check('manager can open Orders', mInvoices.status === 200, 'got ' + mInvoices.status);
  const mCoupons = await get('/admin/coupons');
  check('manager can open Coupons', mCoupons.status === 200, 'got ' + mCoupons.status);
  const mSettings = await get('/admin/settings');
  check('manager cannot open Settings (403)', mSettings.status === 403, 'got ' + mSettings.status);
  const mStaff = await get('/admin/staff');
  check('manager cannot open Staff & Roles (403)', mStaff.status === 403, 'got ' + mStaff.status);

  // (3f) Legacy admin with no role_id still resolves via the old role string.
  await loginAs('legacy@goince.com');
  const lCoupons = await get('/admin/coupons');
  check('legacy manager (no role_id) can open Coupons', lCoupons.status === 200, 'got ' + lCoupons.status);
  const lSettings = await get('/admin/settings');
  check('legacy manager (no role_id) cannot open Settings (403)', lSettings.status === 403, 'got ' + lSettings.status);

  // (6) Direct EJS renders.
  console.log('EJS render');
  const renderFile = util.promisify(ejs.renderFile);
  const ejsLocals = {
    siteName: 'Goince', siteSettings: { logo_url: '/icons/icon-192.png' },
    csrfToken: 'test-csrf', assetUrl: (p) => p, adminPermissions: ALL_PERMISSIONS.slice(),
  };
  const rolesHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'roles.ejs'), {
    ...ejsLocals,
    roles: rolesStore.map((r) => ({ ...r, permissions: parsePermissions(r.permissions), member_count: 1 })),
    message: null, error: null,
  });
  check('roles.ejs renders the list with Create button', has(rolesHtml, 'Create Custom Role') && has(rolesHtml, 'Orders Only'));
  check('roles.ejs shows the Roles sidebar link', has(rolesHtml, '/admin/roles'));
  const formAddHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'role-form.ejs'), {
    ...ejsLocals, role: null, readOnly: false, permissionGroups: PERMISSION_GROUPS, message: null, error: null,
  });
  check('role-form.ejs (add) renders all 4 groups + select-all buttons',
    ['Shop', 'Sales', 'Communication', 'System'].every((g) => has(formAddHtml, g)) && has(formAddHtml, 'Select all'));
  check('role-form.ejs (add) has a checkbox per registry permission',
    ALL_PERMISSIONS.every((id) => has(formAddHtml, `value="${id}"`)));
  const formReadHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'role-form.ejs'), {
    ...ejsLocals, role: { id: 1, name: 'Owner', description: 'Everything.', permissions: ALL_PERMISSIONS.slice() }, readOnly: true,
    permissionGroups: PERMISSION_GROUPS, message: null, error: null,
  });
  check('role-form.ejs (system) renders read-only with disabled checkboxes',
    has(formReadHtml, 'System roles cannot be edited') && has(formReadHtml, 'disabled') && !has(formReadHtml, 'Save Role'));
  const staffHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'staff.ejs'), {
    ...ejsLocals,
    admins: adminsStore.map((a) => ({ id: a.id, email: a.email, role: a.role, role_id: a.role_id, created_at: a.created_at })),
    roles: rolesStore.map((r) => ({ id: r.id, name: r.name, description: r.description, is_system: r.is_system })),
    meId: 1, message: null, error: null,
  });
  check('staff.ejs shows the Manage Roles link', has(staffHtml, '/admin/roles'));
  check('staff.ejs role dropdown lists custom roles', has(staffHtml, 'Orders Only'));
  check('staff.ejs shows the custom role name on the admin row', has(staffHtml, 'Orders Only'));
  // View-only permissions: products list shows no Edit/Delete, order details no status buttons.
  const viewOnly = { ...ejsLocals, adminPermissions: ['products.view', 'orders.view', 'activity.view'] };
  const productsHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'products.ejs'), {
    ...viewOnly,
    products: [{ id: 1, name: 'Test Watch', price: 990, cost_price: null, status: 'published', scheduled_at: null, is_featured: 0, is_new: 0, stock: 15, category_name: 'Winter', target_audience: 'all', video_filename: null, video_id: null, created_at: now }],
    categories: [], categoryGroups: [], category: '', q: '',
  });
  check('products.ejs with view-only perms hides Add/Edit/Delete and shows "View only"',
    !has(productsHtml, '/admin/products/add') && !has(productsHtml, '/admin/products/edit/1') && has(productsHtml, 'View only'));
  const order = orderRows[0];
  const detailsHtml = await renderFile(path.join(__dirname, '..', 'views', 'admin', 'order-details.ejs'), {
    ...viewOnly, order, items: [], history: [], notes: [], phoneHistory: { total: 0, cancelled: 0, delivered: 0 },
    returns: [], advances: [], paid: 0, due: 370, invoiceNo: 'GOINCE-00001', invoiceSends: [],
    orderMsg: null, orderErr: null, shopPhone: '01814697896',
    courier: { configured: false }, courierMsg: null,
  });
  check('order-details.ejs with view-only perms hides the status buttons',
    !has(detailsHtml, '/admin/orders/1/status') && !has(detailsHtml, 'Phone Confirmed</button>'));

  // (7) Source checks.
  console.log('Source checks');
  const adminJs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  check('no requireRole( call remains in routes/admin.js', !adminJs.includes('requireRole('));
  const usedPerms = [...new Set([...adminJs.matchAll(/requirePermission\('([^']+)'\)/g)].map((m) => m[1]))];
  check('every requirePermission id is a real registry id',
    usedPerms.every((id) => ALL_PERMISSIONS.includes(id)), 'bad: ' + usedPerms.filter((id) => !ALL_PERMISSIONS.includes(id)).join(','));
  const formSrc = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'role-form.ejs'), 'utf8');
  check('role editor loops PERMISSION_GROUPS (no hardcoded permission id in the view)',
    formSrc.includes('permissionGroups') && !ALL_PERMISSIONS.some((id) => formSrc.includes(id)));
  const headerSrc = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin-header.ejs'), 'utf8');
  check('sidebar uses permission checks (no _ar role checks left)',
    headerSrc.includes("_can('") && !headerSrc.includes("_ar !== 'staff'") && !headerSrc.includes("_ar === 'owner'"));
  check('sidebar links to /admin/roles', headerSrc.includes('/admin/roles'));
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  check('CSS has the 44px permission rows', css.includes('.perm-check-row') && css.includes('min-height: 44px'));
  check('CSS has 20px permission checkboxes', css.includes('.perm-check-row input[type="checkbox"]') && css.includes('width: 20px'));
  const opens = (css.match(/\{/g) || []).length;
  const closes = (css.match(/\}/g) || []).length;
  check('stylesheet braces balanced', opens === closes, `${opens} open vs ${closes} close`);

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
