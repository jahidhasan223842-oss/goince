// Automated daily database backups (feat/payments-messaging, batch 9 — I12).
//
//   * runBackup() shells out to mysqldump (the MySQL client that
//     ships with the live server) and writes one timestamped
//     .sql file into the app's backups/ directory. The DB password
//     travels via the MYSQL_PWD environment variable — never on
//     the command line, where it would show up in `ps`.
//   * scheduleDailyBackups() runs one backup shortly after boot
//     when there is no backup from today yet, then once every
//     24 hours; each run prunes files older than the retention
//     window (14 days, admin-changeable in Settings).
//   * Every run is recorded in the `backups` table (filename,
//     size, who/what triggered it, error when it failed), so the
//     Admin > System > Backups page can list backups even if the
//     file was later removed by hand.
//   * Backup files are NEVER served publicly: the only download
//     route is admin-only (requireAdmin + backups.manage) and the
//     filename is validated to a plain basename inside backups/
//     — no path traversal, no directory listing.
//
// mysqldump may be missing on a dev machine: runBackup() then
// returns { ok: false, error } with a clear message instead of
// crashing, and the admin page shows that error. The live
// AlmaLinux server has mysqldump with its MySQL install.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BACKUP_RETENTION_DAYS_DEFAULT = 14;
const BACKUP_DIR_NAME = 'backups';

// goince-backup-2026-11-28-183000.sql — sortable, one file per run.
function backupFileName(now) {
  const d = now instanceof Date ? now : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `goince-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.sql`;
}

// Only a plain backup filename is ever accepted from a URL:
// no slashes, no "..", must match the naming scheme. Anything
// else is rejected before the filesystem is touched.
function isSafeBackupFileName(name) {
  return /^goince-backup-\d{4}-\d{2}-\d{2}-\d{6}\.sql$/.test(String(name || ''));
}

function backupDir(appRoot) {
  return path.join(appRoot || process.cwd(), BACKUP_DIR_NAME);
}

// Files on disk, newest first, with sizes. Missing directory =
// no backups yet (not an error).
function listBackupFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names
    .filter((n) => isSafeBackupFileName(n))
    .map((n) => {
      let size = 0;
      let mtime = null;
      try {
        const st = fs.statSync(path.join(dir, n));
        size = st.size;
        mtime = st.mtime;
      } catch (e) { /* file vanished mid-list — skip its size */ }
      return { filename: n, size, mtime };
    })
    .sort((a, b) => (a.filename < b.filename ? 1 : -1));
}

// Pure retention rule (tested without touching disk): which of
// the listed files are older than `retentionDays` before `now`.
function filesToPrune(files, retentionDays, now) {
  const cutoff = (now instanceof Date ? now : new Date()).getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return files.filter((f) => {
    const t = f.mtime ? new Date(f.mtime).getTime() : 0;
    return t < cutoff;
  });
}

function pruneOldBackups(dir, retentionDays) {
  const pruned = [];
  for (const f of filesToPrune(listBackupFiles(dir), retentionDays, new Date())) {
    try {
      fs.unlinkSync(path.join(dir, f.filename));
      pruned.push(f.filename);
    } catch (e) { /* a file that cannot be deleted stays listed */ }
  }
  return pruned;
}

function dbConfigFromEnv(env) {
  const e = env || process.env;
  return {
    host: e.DB_HOST || 'localhost',
    port: e.DB_PORT || '3306',
    user: e.DB_USER || '',
    password: e.DB_PASSWORD || '',
    database: e.DB_NAME || '',
  };
}

// Run one mysqldump. `opts`: { appRoot, db (pool, optional —
// the run is recorded in the backups table when given),
// triggeredBy ('daily' | 'manual' | 'boot'), retentionDays,
// execFileImpl (injectable for tests), now }.
// Returns { ok, filename, size, error }.
function runBackup(opts) {
  const o = opts || {};
  const dir = backupDir(o.appRoot);
  const cfg = o.dbConfig || dbConfigFromEnv(o.env);
  const filename = backupFileName(o.now);
  const fullPath = path.join(dir, filename);
  const execFn = o.execFileImpl || execFile;
  return new Promise((resolve) => {
    if (!cfg.database || !cfg.user) {
      return resolve({ ok: false, error: 'Database connection details are missing — check DB_NAME / DB_USER in the server .env file.' });
    }
    fs.mkdirSync(dir, { recursive: true });
    const args = [
      '--single-transaction', '--routines', '--triggers',
      '-h', String(cfg.host), '-P', String(cfg.port),
      '-u', String(cfg.user), cfg.database,
    ];
    const child = execFn('mysqldump', args, {
      env: Object.assign({}, process.env, { MYSQL_PWD: cfg.password }),
      maxBuffer: 1024 * 1024 * 200,
    });
    if (!child || typeof child.on !== 'function') {
      return resolve({ ok: false, error: 'Could not start mysqldump — is the MySQL client installed on this server?' });
    }
    const out = fs.createWriteStream(fullPath);
    if (child.stdout) child.stdout.pipe(out);
    let stderr = '';
    if (child.stderr) child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => {
      try { fs.unlinkSync(fullPath); } catch (e) { /* nothing to clean */ }
      const missing = /ENOENT/.test(err.message || '');
      resolve({ ok: false, error: missing
        ? 'mysqldump was not found on this server — install the MySQL client to enable backups.'
        : 'Backup failed to start: ' + err.message });
    });
    child.on('close', async (code) => {
      out.end();
      if (code !== 0) {
        try { fs.unlinkSync(fullPath); } catch (e) { /* nothing to clean */ }
        return resolve({ ok: false, error: 'mysqldump exited with code ' + code + (stderr ? ': ' + stderr.slice(0, 300) : '.') });
      }
      let size = 0;
      try { size = fs.statSync(fullPath).size; } catch (e) { /* size stays 0 */ }
      const retentionDays = Number(o.retentionDays) > 0 ? Number(o.retentionDays) : BACKUP_RETENTION_DAYS_DEFAULT;
      pruneOldBackups(dir, retentionDays);
      if (o.db) {
        try {
          await o.db.query(
            'INSERT INTO backups (filename, size_bytes, triggered_by, status) VALUES (?, ?, ?, ?)',
            [filename, size, o.triggeredBy || 'manual', 'ok']
          );
        } catch (e) { /* backup file exists — the table row is a bonus */ }
      }
      resolve({ ok: true, filename, size });
    });
  });
}

// Record a failed run so the admin page can show it.
async function recordBackupFailure(db, filename, triggeredBy, error) {
  if (!db) return;
  try {
    await db.query(
      'INSERT INTO backups (filename, size_bytes, triggered_by, status, error) VALUES (?, ?, ?, ?, ?)',
      [filename || null, 0, triggeredBy || 'manual', 'failed', String(error || '').slice(0, 500)]
    );
  } catch (e) { /* never break the request */ }
}

// Daily schedule: one backup shortly after boot when today has
// no backup yet, then every 24h. Returns the timer handle (so
// tests / shutdown can clearInterval it). Never throws.
function scheduleDailyBackups(opts) {
  const o = opts || {};
  const dir = backupDir(o.appRoot);
  const retentionDays = Number(o.retentionDays) > 0 ? Number(o.retentionDays) : BACKUP_RETENTION_DAYS_DEFAULT;
  const runOnce = async (triggeredBy) => {
    try {
      const result = await runBackup(Object.assign({}, o, { triggeredBy, retentionDays }));
      if (!result.ok && o.db) await recordBackupFailure(o.db, null, triggeredBy, result.error);
      return result;
    } catch (e) {
      if (o.db) await recordBackupFailure(o.db, null, triggeredBy, e.message);
      return { ok: false, error: e.message };
    }
  };
  const hasBackupToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    return listBackupFiles(dir).some((f) => f.filename.indexOf(today) === 'goince-backup-'.length);
  };
  // Boot check after 60s (lets the server finish starting); the
  // 24h timer keeps the daily rhythm after that.
  const bootTimer = setTimeout(() => {
    if (!hasBackupToday()) runOnce('daily');
  }, 60 * 1000);
  if (bootTimer.unref) bootTimer.unref();
  const timer = setInterval(() => { runOnce('daily'); }, 24 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  return { timer, bootTimer, runOnce };
}

module.exports = {
  BACKUP_RETENTION_DAYS_DEFAULT,
  BACKUP_DIR_NAME,
  backupFileName,
  isSafeBackupFileName,
  backupDir,
  listBackupFiles,
  filesToPrune,
  pruneOldBackups,
  dbConfigFromEnv,
  runBackup,
  recordBackupFailure,
  scheduleDailyBackups,
};
