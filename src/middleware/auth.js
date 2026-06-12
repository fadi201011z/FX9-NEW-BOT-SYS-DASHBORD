import config from '../config.js';
import { getBotGuilds } from '../auth/discord.js';

let botGuildCache = { ids: null, lastFetch: 0 };
const CACHE_TTL = 300000;

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

export function isOwner(req, res, next) {
  if (req.session.user && req.session.user.id === config.discord.ownerId) {
    return next();
  }
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Owner only' });
  }
  res.redirect('/access-denied');
}

export async function hasGuildAccess(req, res, next) {
  try {
    const guildId = req.params.guildId || req.query.guildId;
    if (!guildId) return res.status(400).json({ error: 'Guild ID required' });
    const guilds = req.session.user?.guilds || [];
    const hasManageGuild = guilds.some(g => g.id === guildId && (BigInt(g.permissions) & 0x20n) === 0x20n);
    const userId = req.session.user?.id;
    if (userId !== config.discord.ownerId && !hasManageGuild) {
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'No access to this guild' });
      }
      return res.redirect('/access-denied');
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
  const hierarchy = { owner: 4, developer: 4, manager: 3, admin: 2, moderator: 1, support: 0, member: -1 };
  if ((hierarchy[role] ?? -1) >= 3) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'ليس لديك صلاحية التعديل. المدير فقط يمكنه التعديل.' });
  }
  res.status(403).render('error', { layout: false, message: 'ليس لديك صلاحية التعديل. المدير فقط يمكنه التعديل.', user: req.session.user });
}

export function checkPermission(requiredPermission) {
  return (req, res, next) => {
    const userRole = req.session.user?.dashboardRole || 'member';
    const roleHierarchy = { owner: 4, developer: 4, manager: 3, admin: 2, moderator: 1, support: 0, member: -1 };
    const permHierarchy = { owner: 4, developer: 4, manager: 3, admin: 2, moderator: 1, support: 0, member: -1 };
    const required = permHierarchy[requiredPermission] ?? 0;
    const has = roleHierarchy[userRole] ?? -1;
    if (has >= required) return next();
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    res.status(403).render('error', { layout: false, message: 'صلاحياتك غير كافية لهذا الإجراء.', user: req.session.user });
  };
}
