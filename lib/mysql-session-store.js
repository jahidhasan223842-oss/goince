// Persistent MySQL sessions (feat/admin-ops, I1) — an
// express-session Store backed by the existing MySQL pool
// (config/db.js), so a deploy restart no longer logs out all
// admins and empties all customer carts.
//
// No new dependency: the store implements the express-session
// Store interface (get/set/destroy/touch/all/clear/length) on
// top of mysql2, against a `sessions` table the server creates
// on boot (sql/admin_ops.sql):
//   sessions(session_id VARCHAR(128) PK, expires INT, data TEXT)
//
// Graceful fallback: if MySQL is unreachable (table missing,
// DB down at boot), every call falls back to the built-in
// in-memory store for that call and retries MySQL on the next
// call after 60s — the site NEVER fails to start because of
// sessions. Expired rows are pruned once an hour, guarded.
'use strict';

const session = require('express-session');
const db = require('../config/db');

class MySQLSessionStore extends session.Store {
  constructor(options) {
    super(options || {});
    this.memory = new session.MemoryStore();
    this.degradedUntil = 0;
    this.cleanupLogged = false;
    // First-write verification (see set()): a stubbed/fake DB can
    // accept an INSERT and return success without storing anything
    // (the smoke tests stub config/db that way) — sessions would
    // then silently vanish between requests and every CSRF check
    // would fail. Until the first write is proven to persist, the
    // store is unverified.
    this._verified = false;
    this._verifying = false;
    // Prune expired sessions hourly — guarded, never throws.
    this._timer = setInterval(() => {
      if (Date.now() < this.degradedUntil) return;
      db.query('DELETE FROM sessions WHERE expires < UNIX_TIMESTAMP()').catch(() => {});
    }, 60 * 60 * 1000);
    if (this._timer && this._timer.unref) this._timer.unref();
  }

  _useMemory() {
    return Date.now() < this.degradedUntil;
  }
  _degrade(err) {
    if (!this.cleanupLogged) {
      console.error('MySQL session store unavailable — falling back to in-memory sessions:', err && err.message);
      this.cleanupLogged = true;
    }
    // Retry MySQL after 60 seconds.
    this.degradedUntil = Date.now() + 60000;
  }
  _expires(sess) {
    const maxAge = (sess && sess.cookie && sess.cookie.maxAge) || 24 * 60 * 60 * 1000;
    return Math.floor(Date.now() / 1000) + Math.floor(maxAge / 1000);
  }

  get(sid, cb) {
    if (this._useMemory()) return this.memory.get(sid, cb);
    db.query('SELECT data FROM sessions WHERE session_id = ? AND expires > UNIX_TIMESTAMP()', [sid])
      .then(([rows]) => {
        if (!rows || !rows.length) return cb(null, null);
        try { return cb(null, JSON.parse(rows[0].data)); }
        catch (e) { return cb(null, null); }
      })
      .catch((err) => { this._degrade(err); this.memory.get(sid, cb); });
  }

  set(sid, sess, cb) {
    const done = typeof cb === 'function' ? cb : () => {};
    if (this._useMemory()) return this.memory.set(sid, sess, done);
    const data = JSON.stringify(sess);
    const expires = this._expires(sess);
    db.query(
      'INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)',
      [sid, expires, data]
    )
      .then(async () => {
        // First-write verification: read the row back. A fake/stub
        // DB that swallows the INSERT (smoke tests) returns no row
        // — then MySQL is NOT actually storing sessions, so degrade
        // to memory (and keep THIS session in memory too) instead
        // of silently losing every login/CSRF token. A real MySQL
        // returns the row and verification passes once, forever.
        if (!this._verified && !this._verifying) {
          this._verifying = true;
          try {
            const [rows] = await db.query('SELECT data FROM sessions WHERE session_id = ?', [sid]);
            if (rows && rows.length) {
              this._verified = true;
            } else {
              this._degrade(new Error('sessions table write did not persist (stubbed DB?) — using in-memory sessions'));
              // Retry MySQL later, not every minute: a stub never
              // starts persisting, and a real outage is retried
              // on the next verification window.
              this.degradedUntil = Date.now() + 10 * 60 * 1000;
              return this.memory.set(sid, sess, done);
            }
          } catch (err) {
            this._degrade(err);
            return this.memory.set(sid, sess, done);
          } finally {
            this._verifying = false;
          }
        }
        done(null);
      })
      .catch((err) => { this._degrade(err); this.memory.set(sid, sess, done); });
  }

  destroy(sid, cb) {
    const done = typeof cb === 'function' ? cb : () => {};
    if (this._useMemory()) return this.memory.destroy(sid, done);
    db.query('DELETE FROM sessions WHERE session_id = ?', [sid])
      .then(() => done(null))
      .catch((err) => { this._degrade(err); this.memory.destroy(sid, done); });
  }

  touch(sid, sess, cb) {
    const done = typeof cb === 'function' ? cb : () => {};
    if (this._useMemory()) return this.memory.touch(sid, sess, done);
    db.query('UPDATE sessions SET expires = ? WHERE session_id = ?', [this._expires(sess), sid])
      .then(() => done(null))
      .catch((err) => { this._degrade(err); this.memory.touch(sid, sess, done); });
  }

  all(cb) {
    if (this._useMemory()) return this.memory.all(cb);
    db.query('SELECT session_id, data FROM sessions WHERE expires > UNIX_TIMESTAMP()')
      .then(([rows]) => {
        const out = {};
        for (const r of rows || []) {
          try { out[r.session_id] = JSON.parse(r.data); } catch (e) { /* skip corrupt row */ }
        }
        cb(null, out);
      })
      .catch((err) => { this._degrade(err); this.memory.all(cb); });
  }

  clear(cb) {
    const done = typeof cb === 'function' ? cb : () => {};
    if (this._useMemory()) return this.memory.clear(done);
    db.query('DELETE FROM sessions')
      .then(() => done(null))
      .catch((err) => { this._degrade(err); this.memory.clear(done); });
  }

  length(cb) {
    if (this._useMemory()) return this.memory.length(cb);
    db.query('SELECT COUNT(*) AS c FROM sessions WHERE expires > UNIX_TIMESTAMP()')
      .then(([[row]]) => cb(null, Number((row && row.c) || 0)))
      .catch((err) => { this._degrade(err); this.memory.length(cb); });
  }
}

module.exports = MySQLSessionStore;
