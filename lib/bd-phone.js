// Bangladeshi mobile number — shared by the shop checkout (routes/shop.js)
// and the admin profile (routes/admin.js). One rule everywhere:
// 01XXXXXXXXX or +8801XXXXXXXXX, starting with 013–019.
// Moved here (fix/admin-profile-photo) so both routes validate the same way.
'use strict';

function normalizeBdPhone(raw) {
  let p = String(raw || '').replace(/[^0-9+]/g, '');
  if (p.startsWith('+880')) p = '0' + p.slice(4);
  else if (p.startsWith('880')) p = '0' + p.slice(3);
  return p;
}

function isValidBdPhone(raw) {
  return /^01[3-9][0-9]{8}$/.test(normalizeBdPhone(raw));
}

module.exports = { normalizeBdPhone, isValidBdPhone };
