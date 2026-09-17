import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'election.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Who is allowed to vote. Deliberately holds NO reference to any ballot.
CREATE TABLE IF NOT EXISTS voters (
  student_no   TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  year_level   TEXT NOT NULL,
  access_code  TEXT NOT NULL,          -- one-time code handed out by the committee
  role         TEXT NOT NULL DEFAULT 'voter',
  has_voted    INTEGER NOT NULL DEFAULT 0,
  voted_at     TEXT
);

-- Short-lived login sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  student_no TEXT NOT NULL REFERENCES voters(student_no),
  role       TEXT NOT NULL,            -- 'voter' | 'committee'
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  seats      INTEGER NOT NULL DEFAULT 1,
  method     TEXT NOT NULL,            -- 'irv' (1 seat) | 'approval' (N seats)
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id          TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES positions(id),
  name        TEXT NOT NULL,
  party       TEXT NOT NULL,
  year_level  TEXT NOT NULL,
  platform    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

-- Sealed ballots. No voter column, by design: the roster records THAT you voted,
-- this table records WHAT was voted. Nothing joins the two.
CREATE TABLE IF NOT EXISTS ballots (
  serial       TEXT PRIMARY KEY,       -- random, printed on the voter's stub
  receipt      TEXT NOT NULL UNIQUE,   -- hash of the sealed contents
  choices_json TEXT NOT NULL,
  sealed_at    TEXT NOT NULL
);

-- Append-only, hash-chained. Any edit or deletion breaks the chain.
CREATE TABLE IF NOT EXISTS audit_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  event      TEXT NOT NULL,
  detail     TEXT NOT NULL,
  prev_hash  TEXT NOT NULL,
  entry_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const rand = (n = 16) => randomBytes(n).toString('hex');

export function setting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

/** Appends an entry whose hash includes the previous entry's hash. */
export function audit(event, detail = {}) {
  const prev = db.prepare('SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1').get();
  const prevHash = prev ? prev.entry_hash : 'genesis';
  const at = new Date().toISOString();
  const body = JSON.stringify(detail);
  const entryHash = sha256(`${prevHash}|${at}|${event}|${body}`);
  db.prepare(
    'INSERT INTO audit_log (at, event, detail, prev_hash, entry_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(at, event, body, prevHash, entryHash);
  return entryHash;
}

/** Recomputes the whole chain. Returns the first seq where it breaks, or null. */
export function verifyAuditChain() {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all();
  let prevHash = 'genesis';
  for (const r of rows) {
    const expected = sha256(`${prevHash}|${r.at}|${r.event}|${r.detail}`);
    if (r.prev_hash !== prevHash || r.entry_hash !== expected) return { ok: false, brokenAt: r.seq };
    prevHash = r.entry_hash;
  }
  return { ok: true, entries: rows.length, head: prevHash };
}

/** node:sqlite has no transaction() helper, so wrap one here. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
