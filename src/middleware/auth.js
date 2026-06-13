import config from '../config.js';
import { getBotGuilds } from '../auth/discord.js';
import Admin from '../models/Admin.js';

let botGuildCache = { ids: null, lastFetch: 0 };

export function clearBotGuildCache() {
  botGuildCache = { ids: null, lastFetch: 0 };
}
const CACHE_TTL = 300000;

let roleRefreshCache = {};

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

export function requireRole(minRole) {
  return (req, res, next) => {
    const role = req.session.user?.dashboardRole || 'member';
    if ((ROLE_HIERARCHY[role] ?? -1) >= (ROLE_HIERARCHY[minRole] ?? 0)) return next();
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    res.status(403).render('error', { layout: false, message: 'صلاحياتك غير كافية لهذه الصفحة.', user: req.session.user });
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
