import User from './models/User.js';
import Admin from './models/Admin.js';
import Activity from './models/Activity.js';
import AuditLog from './models/AuditLog.js';
import CommandConfig from './models/CommandConfig.js';
import Alert from './models/Alert.js';
import Backup from './models/Backup.js';
import GuildAdminRole from './models/GuildAdminRole.js';
import GuildConfig from './models/GuildConfig.js';
import { connectDB } from './models/connection.js';

await connectDB();

// ─── Users ────────────────────────────────────────────────────────────────

export async function upsertUser(userId, username, avatar) {
  await User.findOneAndUpdate(
    { userId },
    { username, avatar, lastLogin: Date.now() },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

export async function getUser(userId) {
  return User.findOne({ userId }).lean();
}

// ─── Admins ───────────────────────────────────────────────────────────────

export async function setAdminRole(userId, guildId, role, addedBy) {
  await Admin.findOneAndUpdate(
    { userId, guildId },
    { role, addedBy, addedAt: Date.now() },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

export async function getAdminRole(userId, guildId) {
  return Admin.findOne({ userId, guildId }).lean();
}

export async function getGuildAdmins(guildId) {
  const admins = await Admin.find({ guildId }).sort({ role: 1 }).lean();
  const userIds = admins.map(a => a.userId);
  const users = await User.find({ userId: { $in: userIds } }).lean();
  const userMap = {};
  for (const u of users) userMap[u.userId] = u;
  return admins.map(a => ({
    ...a,
    username: userMap[a.userId]?.username,
    avatar: userMap[a.userId]?.avatar,
  }));
}

export async function removeAdmin(userId, guildId) {
  await Admin.deleteOne({ userId, guildId });
}

export async function getUserAdminGuilds(userId) {
  return Admin.find({ userId }).lean();
}

// ─── Activity Logs ────────────────────────────────────────────────────────

export async function logActivity(userId, guildId, action, target, details, ip, sessionId) {
  await Activity.create({ userId, guildId, action, target, details, ipAddress: ip, sessionId, timestamp: Date.now() });
}

export async function getActivity(guildId, limit = 100) {
  const activities = await Activity.find({ guildId }).sort({ timestamp: -1 }).limit(limit).lean();
  const userIds = [...new Set(activities.map(a => a.userId).filter(Boolean))];
  const users = await User.find({ userId: { $in: userIds } }).lean();
  const userMap = {};
  for (const u of users) userMap[u.userId] = u;
  return activities.map(a => ({
    ...a,
    username: userMap[a.userId]?.username,
    avatar: userMap[a.userId]?.avatar,
  }));
}

export async function getUserActivity(userId, limit = 50) {
  return Activity.find({ userId }).sort({ timestamp: -1 }).limit(limit).lean();
}

// ─── Audit Logs ───────────────────────────────────────────────────────────

export async function logAudit(userId, guildId, action, field, oldValue, newValue, ip, sessionId) {
  await AuditLog.create({ userId, guildId, action, field, oldValue, newValue, ipAddress: ip, sessionId, timestamp: Date.now() });
}

export async function getAuditLogs(guildId, limit = 100) {
  const logs = await AuditLog.find({ guildId }).sort({ timestamp: -1 }).limit(limit).lean();
  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))];
  const users = await User.find({ userId: { $in: userIds } }).lean();
  const userMap = {};
  for (const u of users) userMap[u.userId] = u;
  return logs.map(l => ({
    ...l,
    username: userMap[l.userId]?.username,
    avatar: userMap[l.userId]?.avatar,
  }));
}

// ─── Command Config ───────────────────────────────────────────────────────

export async function getCommandConfig(guildId, commandName) {
  return CommandConfig.findOne({ guildId, commandName }).lean();
}

export async function setCommandConfig(guildId, commandName, data) {
  await CommandConfig.findOneAndUpdate(
    { guildId, commandName },
    {
      enabled: data.enabled,
      allowedRoles: data.allowedRoles || [],
      blockedRoles: data.blockedRoles || [],
      allowedChannels: data.allowedChannels || [],
      blockedChannels: data.blockedChannels || [],
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

export async function getAllCommandConfigs(guildId) {
  return CommandConfig.find({ guildId }).lean();
}

// ─── Alerts ───────────────────────────────────────────────────────────────

export async function createAlert(guildId, type, severity, title, message) {
  await Alert.create({ guildId, type, severity, title, message, timestamp: Date.now() });
}

export async function getAlerts(guildId, limit = 50) {
  return Alert.find({ guildId }).sort({ timestamp: -1 }).limit(limit).lean();
}

export async function markAlertRead(alertId) {
  await Alert.findByIdAndUpdate(alertId, { read: true });
}

export async function getUnreadAlerts(guildId) {
  return Alert.find({ guildId, read: false }).sort({ timestamp: -1 }).lean();
}

// ─── Backup ───────────────────────────────────────────────────────────────

export async function createBackupRecord(guildId, filename, size, includes) {
  await Backup.create({ guildId, filename, size, createdAt: Date.now(), includes });
}

export async function getBackupHistory(guildId, limit = 20) {
  return Backup.find({ guildId }).sort({ createdAt: -1 }).limit(limit).lean();
}

// ─── Bot Config (guild_config collection) ─────────────────────────────────

export async function getGuildConfig(guildId, key) {
  const doc = await GuildConfig.findOne({ guildId, key }).lean();
  return doc ? doc : null;
}

export async function setGuildConfig(guildId, key, value) {
  await GuildConfig.findOneAndUpdate(
    { guildId, key },
    { value },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

export async function getAllGuildConfig(guildId) {
  const rows = await GuildConfig.find({ guildId }).lean();
  const config = {};
  for (const row of rows) config[row.key] = row.value;
  return config;
}

export async function deleteGuildConfig(guildId, key) {
  await GuildConfig.deleteOne({ guildId, key });
}

// ─── Dashboard User Settings ──────────────────────────────────────────────

export async function updateUserSettings(userId, settings) {
  const user = await getUser(userId);
  if (!user) return;
  const current = user.settings || {};
  const merged = { ...current, ...settings };
  await User.findOneAndUpdate({ userId }, { settings: merged });
}

export async function getUserSettings(userId) {
  const user = await getUser(userId);
  return user?.settings || { theme: 'dark' };
}

// ─── Admin Roles (Role-based Admin Management) ────────────────────────────

export async function getGuildAdminRoles(guildId) {
  return GuildAdminRole.find({ guildId }).sort({ addedAt: 1 }).lean();
}

export async function setGuildAdminRole(guildId, roleId, level, addedBy) {
  await GuildAdminRole.findOneAndUpdate(
    { guildId, roleId },
    { level, addedBy, addedAt: Date.now() },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

export async function removeGuildAdminRole(guildId, roleId) {
  await GuildAdminRole.deleteOne({ guildId, roleId });
}

export async function clearGuildAdminRoles(guildId) {
  await GuildAdminRole.deleteMany({ guildId });
}

export async function getGuildAdminRoleIds(guildId) {
  return GuildAdminRole.find({ guildId }).lean();
}

// ─── Extra helpers for admins.js raw queries ──────────────────────────────

export async function getAdminsByGuildAndAddedBy(guildId, addedBy) {
  return Admin.find({ guildId, addedBy }).lean();
}

export async function removeAdminByUserGuildAddedBy(userId, guildId, addedBy) {
  await Admin.deleteOne({ userId, guildId, addedBy });
}

export async function addAdminRaw(userId, guildId, role, addedBy) {
  await Admin.create({ userId, guildId, role, addedBy, addedAt: Date.now() });
}

export async function getAllGuildIdsWithAdminRoles() {
  return GuildAdminRole.distinct('guildId');
}
