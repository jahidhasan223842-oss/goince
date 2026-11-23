// CSRF protection: synchronizer token stored in the session.
// - Every GET renders with res.locals.csrfToken; every POST form carries it as a
//   hidden _csrf field (see views/partials/csrf-field.ejs).
// - Multipart forms (multer) cannot be read before the route runs, so those
//   forms ALSO carry the token in the action URL (?_csrf=...), which Express
//   parses before any body parser. The middleware accepts body, query or the
//   x-csrf-token header (used by JSON fetch() calls).
// - No new dependency: crypto.randomBytes, timingSafeEqual compare.
const crypto = require('crypto');

function csrfProtection(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  if (req.method !== 'POST') return next();
  const sent = String((req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token') || '');
  let ok = false;
  try {
    const a = Buffer.from(sent, 'utf8');
    const b = Buffer.from(req.session.csrfToken, 'utf8');
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    return res.status(403).send(
      'Security check failed (invalid form token). Please go back, reload the page and try again.'
    );
  }
  next();
}

module.exports = { csrfProtection };
