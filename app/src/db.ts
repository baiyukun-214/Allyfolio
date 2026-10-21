import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';

// Schema uses portable SQL (TEXT ids, ISO timestamps, INTEGER flags) so it maps 1:1 to Postgres.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, token TEXT NOT NULL, created_at TEXT NOT NULL,
  confirmed_at TEXT, early_bird INTEGER NOT NULL DEFAULT 0, source_ip TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT, name TEXT, created_at TEXT NOT NULL, email_verified_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_tokens (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'none', created_at TEXT NOT NULL,
  stripe_customer_id TEXT, stripe_subscription_id TEXT, subscription_status TEXT, current_period_end TEXT, pending_plan TEXT,
  oneoff_credits INTEGER NOT NULL DEFAULT 0,
  brand_name TEXT, brand_color TEXT, brand_logo_url TEXT
);
CREATE TABLE IF NOT EXISTS memberships (team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (team_id, user_id));
CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, email TEXT NOT NULL, created_at TEXT NOT NULL, accepted_at TEXT);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, name TEXT NOT NULL, origin TEXT NOT NULL,
  verify_token TEXT NOT NULL, verified_at TEXT, verify_method TEXT, created_at TEXT NOT NULL, next_scan_at TEXT, oneoff INTEGER NOT NULL DEFAULT 0,
  UNIQUE (team_id, origin)
);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY, site_id TEXT REFERENCES sites(id) ON DELETE CASCADE, kind TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, pages_scanned INTEGER NOT NULL DEFAULT 0, page_limit INTEGER,
  critical INTEGER NOT NULL DEFAULT 0, serious INTEGER NOT NULL DEFAULT 0, moderate INTEGER NOT NULL DEFAULT 0, minor INTEGER NOT NULL DEFAULT 0,
  new_issues INTEGER, fixed_issues INTEGER, error TEXT, prev_hash TEXT, evidence_hash TEXT
);
CREATE INDEX IF NOT EXISTS scans_site ON scans(site_id, created_at);
CREATE TABLE IF NOT EXISTS scan_pages (scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, url TEXT NOT NULL, status INTEGER, error TEXT, PRIMARY KEY (scan_id, url));
CREATE TABLE IF NOT EXISTS scan_issues (
  id INTEGER PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, page_url TEXT NOT NULL, rule_id TEXT NOT NULL,
  impact TEXT NOT NULL, wcag TEXT, help TEXT NOT NULL, help_url TEXT, target TEXT NOT NULL, html TEXT, fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issues_scan ON scan_issues(scan_id);
-- Evidence trail is append-only: issues can never be edited, finished scans can never be edited.
CREATE TRIGGER IF NOT EXISTS issues_no_update BEFORE UPDATE ON scan_issues BEGIN SELECT RAISE(ABORT, 'scan_issues are immutable'); END;
CREATE TRIGGER IF NOT EXISTS scans_no_update_done BEFORE UPDATE ON scans WHEN OLD.status IN ('done','failed') BEGIN SELECT RAISE(ABORT, 'finished scans are immutable'); END;
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', run_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, locked_at TEXT, last_error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status, run_at);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, path TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TEXT NOT NULL);
`;

let _db: DatabaseSync | undefined;
export function db(): DatabaseSync {
  if (_db) return _db;
  if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
  _db = new DatabaseSync(config.dbPath);
  _db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  _db.exec(SCHEMA);
  return _db;
}
export const now = () => new Date().toISOString();
export const get = <T = any>(sql: string, ...p: any[]) => db().prepare(sql).get(...p) as T | undefined;
export const all = <T = any>(sql: string, ...p: any[]) => db().prepare(sql).all(...p) as T[];
export const run = (sql: string, ...p: any[]) => db().prepare(sql).run(...p);
export function tx<T>(fn: () => T): T {
  db().exec('BEGIN IMMEDIATE');
  try { const r = fn(); db().exec('COMMIT'); return r; } catch (e) { db().exec('ROLLBACK'); throw e; }
}
