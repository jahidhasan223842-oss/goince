// Customer (shop) profile helpers (fix/customer-profile-section):
// display-name fallback + member-since formatting. Pure functions so
// the test suite can exercise them without a live database.
//
// The users table already has a `name` column (NOT NULL, required at
// signup), so there is no separate display_name column like the admins
// table has. The rule is the same as the admin's: the name shown is
// the stored name, and when it is ever empty the email local part is
// shown instead — the fallback is never baked into the DB (the PR #62
// lesson: pre-filling/saving the fallback made the name un-clearable).
'use strict';

function customerDisplayName(user) {
  const name = String((user && user.name) || '').trim();
  if (name) return name;
  const email = String((user && user.email) || '');
  return (email.split('@')[0] || 'Customer');
}

// Same "19 Sep 2026" style as the admin profile page.
function formatMemberSince(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return null; }
}

module.exports = { customerDisplayName, formatMemberSince };
