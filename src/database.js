import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import config from './config.js';

const dbPath = config.db.path;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_users (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    avatar TEXT,
    last_login INTEGER,
    role TEXT DEFAULT 'member',
    permissions TEXT DEFAULT '{}',
    settings TEXT DEFAULT '{"theme":"dark"}'
  );

  CREATE TABLE IF NOT EXISTS dashboard_admins (
    user_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'moderator',
    added_by TEXT,
    added_at INTEGER,
    permissions TEXT DEFAULT '{}',
    FOREIGN KEY (user_id) REFERENCES dashboard_users(user_id)
  );

  CREATE TABLE IF NOT EXISTS admin_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    ip_address TEXT,
    session_id TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    session_id TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS command_config (
    guild_id TEXT NOT NULL,
    command_name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    allowed_roles TEXT DEFAULT '[]',
    allowed_channels TEXT DEFAULT '[]',
    blocked_channels TEXT DEFAULT '[]',
    PRIMARY KEY (guild_id, command_name)
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    title TEXT,
    message TEXT,
    read INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backup_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER,
    created_at INTEGER,
    includes TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS dashboard_sessions (
    sid TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT
  );

  CREATE TABLE IF NOT EXISTS guild_admin_roles (
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'moderator',
    added_by TEXT,
    added_at INTEGER,
    PRIMARY KEY (guild_id, role_id)
  );
`);

try { db.exec('ALTER TABLE command_config ADD COLUMN blocked_roles TEXT DEFAULT \'[]\''); } catch (e) {}

export default db;

// ─── Users ────────────────────────────────────────────────────────────────

export function upsertUser(userId, username, avatar) {
  const existing = db.prepare('SELECT * FROM dashboard_users WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare('UPDATE dashboard_users SET username = ?, avatar = ?, last_login = ? WHERE user_id = ?')
      .run(username, avatar, Date.now(), userId);
  } else {
    db.prepare('INSERT INTO dashboard_users (user_id, username, avatar, last_login) VALUES (?, ?, ?, ?)')
      .run(userId, username, avatar, Date.now());
  }
}

export function getUser(userId) {
  return db.prepare('SELECT * FROM dashboard_users WHERE user_id = ?').get(userId);
}

// ─── Admins ───────────────────────────────────────────────────────────────

export function setAdminRole(userId, guildId, role, addedBy) {
  const existing = db.prepare('SELECT * FROM dashboard_admins WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
  if (existing) {
    db.prepare('UPDATE dashboard_admins SET role = ?, added_by = ?, added_at = ? WHERE user_id = ? AND guild_id = ?')
      .run(role, addedBy, Date.now(), userId, guildId);
  } else {
    db.prepare('INSERT INTO dashboard_admins (user_id, guild_id, role, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, guildId, role, addedBy, Date.now());
  }
}

export function getAdminRole(userId, guildId) {
  return db.prepare('SELECT * FROM dashboard_admins WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
}

export function getGuildAdmins(guildId) {
  return db.prepare('SELECT da.*, du.username, du.avatar FROM dashboard_admins da LEFT JOIN dashboard_users du ON da.user_id = du.user_id WHERE da.guild_id = ? ORDER BY da.role').all(guildId);
}

export function removeAdmin(userId, guildId) {
  db.prepare('DELETE FROM dashboard_admins WHERE user_id = ? AND guild_id = ?').run(userId, guildId);
}

export function getUserAdminGuilds(userId) {
  return db.prepare('SELECT * FROM dashboard_admins WHERE user_id = ?').all(userId);
}

// ─── Activity Logs ────────────────────────────────────────────────────────

export function logActivity(userId, guildId, action, target, details, ip, sessionId) {
  db.prepare('INSERT INTO admin_activity (user_id, guild_id, action, target, details, ip_address, session_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, guildId, action, target, details, ip, sessionId, Date.now());
}

export function getActivity(guildId, limit = 100) {
  return db.prepare('SELECT aa.*, du.username, du.avatar FROM admin_activity aa LEFT JOIN dashboard_users du ON aa.user_id = du.user_id WHERE aa.guild_id = ? ORDER BY aa.timestamp DESC LIMIT ?').all(guildId, limit);
}

export function getUserActivity(userId, limit = 50) {
  return db.prepare('SELECT * FROM admin_activity WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?').all(userId, limit);
}

// ─── Audit Logs ───────────────────────────────────────────────────────────

export function logAudit(userId, guildId, action, field, oldValue, newValue, ip, sessionId) {
  db.prepare('INSERT INTO audit_logs (user_id, guild_id, action, field, old_value, new_value, ip_address, session_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, guildId, action, field, oldValue, newValue, ip, sessionId, Date.now());
}

export function getAuditLogs(guildId, limit = 100) {
  return db.prepare('SELECT al.*, du.username, du.avatar FROM audit_logs al LEFT JOIN dashboard_users du ON al.user_id = du.user_id WHERE al.guild_id = ? ORDER BY al.timestamp DESC LIMIT ?').all(guildId, limit);
}

// ─── Command Config ───────────────────────────────────────────────────────

export function getCommandConfig(guildId, commandName) {
  return db.prepare('SELECT * FROM command_config WHERE guild_id = ? AND command_name = ?').get(guildId, commandName);
}

export function setCommandConfig(guildId, commandName, data) {
  const existing = getCommandConfig(guildId, commandName);
  if (existing) {
    db.prepare('UPDATE command_config SET enabled = ?, allowed_roles = ?, blocked_roles = ?, allowed_channels = ?, blocked_channels = ? WHERE guild_id = ? AND command_name = ?')
      .run(data.enabled, JSON.stringify(data.allowedRoles || []), JSON.stringify(data.blockedRoles || []), JSON.stringify(data.allowedChannels || []), JSON.stringify(data.blockedChannels || []), guildId, commandName);
  } else {
    db.prepare('INSERT INTO command_config (guild_id, command_name, enabled, allowed_roles, blocked_roles, allowed_channels, blocked_channels) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(guildId, commandName, data.enabled, JSON.stringify(data.allowedRoles || []), JSON.stringify(data.blockedRoles || []), JSON.stringify(data.allowedChannels || []), JSON.stringify(data.blockedChannels || []));
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
}

export function getAllCommandConfigs(guildId) {
  return db.prepare('SELECT * FROM command_config WHERE guild_id = ?').all(guildId);
}

// ─── Alerts ───────────────────────────────────────────────────────────────

export function createAlert(guildId, type, severity, title, message) {
  db.prepare('INSERT INTO alerts (guild_id, type, severity, title, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
    .run(guildId, type, severity, title, message, Date.now());
}

export function getAlerts(guildId, limit = 50) {
  return db.prepare('SELECT * FROM alerts WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?').all(guildId, limit);
}

export function markAlertRead(alertId) {
  db.prepare('UPDATE alerts SET read = 1 WHERE id = ?').run(alertId);
}

export function getUnreadAlerts(guildId) {
  return db.prepare('SELECT * FROM alerts WHERE guild_id = ? AND read = 0 ORDER BY timestamp DESC').all(guildId);
}

// ─── Backup ───────────────────────────────────────────────────────────────

export function createBackupRecord(guildId, filename, size, includes) {
  db.prepare('INSERT INTO backup_history (guild_id, filename, size, created_at, includes) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, filename, size, Date.now(), JSON.stringify(includes));
}

export function getBackupHistory(guildId, limit = 20) {
  return db.prepare('SELECT * FROM backup_history WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit);
}

// ─── Bot Config (from guild_config table) ─────────────────────────────────

export function getGuildConfig(guildId, key) {
  return db.prepare('SELECT value FROM guild_config WHERE guild_id = ? AND key = ?').get(guildId, key);
}

export function setGuildConfig(guildId, key, value) {
  db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, key, value) VALUES (?, ?, ?)').run(guildId, key, value);
}

export function getAllGuildConfig(guildId) {
  const rows = db.prepare('SELECT key, value FROM guild_config WHERE guild_id = ?').all(guildId);
  const config = {};
  for (const row of rows) config[row.key] = row.value;
  return config;
}

export function deleteGuildConfig(guildId, key) {
  db.prepare('DELETE FROM guild_config WHERE guild_id = ? AND key = ?').run(guildId, key);
}

// ─── Dashboard User Settings ──────────────────────────────────────────────

export function updateUserSettings(userId, settings) {
  const user = getUser(userId);
  if (!user) return;
  const current = user.settings ? JSON.parse(user.settings) : {};
  const merged = { ...current, ...settings };
  db.prepare('UPDATE dashboard_users SET settings = ? WHERE user_id = ?').run(JSON.stringify(merged), userId);
}

export function getUserSettings(userId) {
  const user = getUser(userId);
  return user && user.settings ? JSON.parse(user.settings) : { theme: 'dark' };
}

// ─── Admin Roles (Role-based Admin Management) ────────────────────────────

export function getGuildAdminRoles(guildId) {
  return db.prepare('SELECT * FROM guild_admin_roles WHERE guild_id = ? ORDER BY added_at').all(guildId);
}

export function setGuildAdminRole(guildId, roleId, level, addedBy) {
  const existing = db.prepare('SELECT * FROM guild_admin_roles WHERE guild_id = ? AND role_id = ?').get(guildId, roleId);
  if (existing) {
    db.prepare('UPDATE guild_admin_roles SET level = ?, added_by = ?, added_at = ? WHERE guild_id = ? AND role_id = ?')
      .run(level, addedBy, Date.now(), guildId, roleId);
  } else {
    db.prepare('INSERT INTO guild_admin_roles (guild_id, role_id, level, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
      .run(guildId, roleId, level, addedBy, Date.now());
  }
}

export function removeGuildAdminRole(guildId, roleId) {
  db.prepare('DELETE FROM guild_admin_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
}

export function clearGuildAdminRoles(guildId) {
  db.prepare('DELETE FROM guild_admin_roles WHERE guild_id = ?').run(guildId);
}

export function getGuildAdminRoleIds(guildId) {
  const rows = db.prepare('SELECT role_id, level FROM guild_admin_roles WHERE guild_id = ?').all(guildId);
  return rows;
}
