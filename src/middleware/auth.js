import config from '../config.js';
import { getBotGuilds } from '../auth/discord.js';
import Admin from '../models/Admin.js';

let botGuildCache = { ids: null, lastFetch: 0 };

export function clearBotGuildCache() {
  botGuildCache = { ids: null, lastFetch: 0 };
}
const CACHE_TTL = 300000;

let roleRefreshCache = {};

export function clearDashboardRoleCache(userId) {
  delete roleRefreshCache[userId];
}

export async function refreshDashboardRole(req, res, next) {
  if (!req.session?.user || req.session.user.isOwner) return next();
  const userId = req.session.user.id;
  const now = Date.now();
  const cached = roleRefreshCache[userId];
  if (cached && now - cached.ts < 60000) {
    if (cached.role !== req.session.user.dashboardRole) {
      req.session.user.dashboardRole = cached.role;
    }
    return next();
  }
  try {
    const adminGuilds = await Admin.find({ userId }).collation({ locale: 'en', strength: 2 }).lean();
    const hierarchy = { owner: 4, manager: 3, admin: 2, moderator: 1, support: 0 };
    let best = null, bestLevel = -1;
    for (const a of adminGuilds) {
      const level = hierarchy[a.role] ?? -1;
      if (level > bestLevel) { bestLevel = level; best = a.role; }
    }
    const newRole = best || 'member';
    roleRefreshCache[userId] = { role: newRole, ts: now };
    if (newRole !== req.session.user.dashboardRole) {
      req.session.user.dashboardRole = newRole;
    }
  } catch {}
  next();
}

async function getBotGuildIds() {
  if (botGuildCache.ids) {
    if (Date.now() - botGuildCache.lastFetch < CACHE_TTL) return botGuildCache.ids;
    if (botGuildCache.rateLimited && Date.now() - botGuildCache.lastFetch < 60000) return botGuildCache.ids;
  }
  try {
    const guilds = await getBotGuilds(config.discord.botToken);
    botGuildCache = { ids: new Set((guilds || []).map(g => g.id)), lastFetch: Date.now() };
  } catch (e) {
    if (e?.response?.status === 429) {
      botGuildCache.rateLimited = true;
    }
  }
  return botGuildCache.ids;
}

export function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/');
}

export const ROLE_HIERARCHY = { owner: 4, developer: 4, manager: 3, admin: 2, moderator: 1, support: 0, member: -1 };

export const ROLE_LABELS = { manager: 'مدير', admin: 'مبرمج', moderator: 'آدمن', support: 'دعم', member: 'عضو' };

// Effective permission level WITHIN a specific guild only (per-guild, not global).
// A support member in guild X no longer inherits a manager role from guild Y.
export async function getGuildLevel(user, guildId) {
  if (!user) return -1;
  if (user.id === config.discord.ownerId) return 4;
  let best = -1;
  try {
    const a = await Admin.findOne({ userId: user.id, guildId }).collation({ locale: 'en', strength: 2 }).lean();
    if (a) best = Math.max(best, ROLE_HIERARCHY[a.role] ?? -1);
  } catch {}
  const g = (user.guilds || []).find(x => x.id === guildId);
  const perms = g && g.permissions;
  if (perms) {
    try {
      const p = BigInt(perms);
      if ((p & 0x8n) === 0x8n || (p & 0x20n) === 0x20n) best = Math.max(best, 3);
    } catch {}
  }
  return best;
}

export function roleTokenFromLevel(level) {
  if (level >= 4) return 'owner';
  if (level >= 3) return 'manager';
  if (level >= 2) return 'admin';
  if (level >= 1) return 'moderator';
  if (level >= 0) return 'support';
  return 'member';
}

export function requireRole(minRole) {
  return async (req, res, next) => {
    const user = req.session.user;
    let level;
    if (req.params.guildId) {
      level = await getGuildLevel(user, req.params.guildId);
    } else {
      const role = user?.dashboardRole || 'member';
      level = ROLE_HIERARCHY[role] ?? -1;
    }
    if (level >= (ROLE_HIERARCHY[minRole] ?? 0)) return next();
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'ليس لديك صلاحيات لهذه المنطقة' });
    }
    res.status(403).render('error', { layout: false, message: 'ليس لديك صلاحيات لهذه المنطقة', user });
  };
}

export function isOwner(req, res, next) {
  if (req.session.user && req.session.user.id === config.discord.ownerId) {
    return next();
  }
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Owner only' });
  }
  res.redirect('/access-denied?reason=owner');
}

export async function hasGuildAccess(req, res, next) {
  try {
    const guildId = req.params.guildId || req.query.guildId;
    if (!guildId) return res.status(400).json({ error: 'Guild ID required' });
    const guilds = req.session.user?.guilds || [];
    const perms = guilds.find(g => g.id === guildId)?.permissions;
    const hasGuildPerm = perms ? ((BigInt(perms) & 0x8n) === 0x8n || (BigInt(perms) & 0x20n) === 0x20n) : false;
    const userId = req.session.user?.id;
    const isAdmin = userId ? await Admin.findOne({ userId, guildId }).collation({ locale: 'en', strength: 2 }).lean() : null;
    if (userId !== config.discord.ownerId && !hasGuildPerm && !isAdmin) {
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'No access to this guild' });
      }
      return res.redirect('/access-denied?reason=guild');
    }
    const botIds = await getBotGuildIds();
    if (botIds && !botIds.has(guildId)) {
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'البوت غير موجود في هذا السيرفر', detail: 'أضف البوت إلى السيرفر أولاً' });
      }
      return res.status(404).render('error', { layout: false, message: 'البوت غير موجود في هذا السيرفر. أضف البوت أولاً.', user: req.session.user });
    }
    next();
  } catch (err) {
    console.error('[hasGuildAccess Error]', err);
    res.status(500).json({ error: 'Internal error checking guild access' });
  }
}

export function canModify(req, res, next) {
  const role = req.session.user?.dashboardRole || 'member';
  if ((ROLE_HIERARCHY[role] ?? -1) >= 3) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'ليس لديك صلاحية التعديل. المدير فقط يمكنه التعديل.' });
  }
  res.status(403).render('error', { layout: false, message: 'ليس لديك صلاحية التعديل. المدير فقط يمكنه التعديل.', user: req.session.user });
}

export async function isOwnerOrAdmin(req, res, next) {
  if (req.session.user?.id === config.discord.ownerId) return next();
  const adminCount = await Admin.countDocuments({ userId: req.session.user?.id });
  if (adminCount > 0) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Owner or admin only' });
  }
  res.redirect('/access-denied?reason=owner');
}

export function checkPermission(requiredPermission) {
  return (req, res, next) => {
    const userRole = req.session.user?.dashboardRole || 'member';
    const required = ROLE_HIERARCHY[requiredPermission] ?? 0;
    const has = ROLE_HIERARCHY[userRole] ?? -1;
    if (has >= required) return next();
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    res.status(403).render('error', { layout: false, message: 'صلاحياتك غير كافية لهذا الإجراء.', user: req.session.user });
  };
}
