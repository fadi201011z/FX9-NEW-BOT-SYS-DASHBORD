import config from '../config.js';
import { getBotGuilds, refreshToken, getUserGuilds } from '../auth/discord.js';
import Admin from '../models/Admin.js';
import { getGuildConfig } from '../database.js';
import { botFetch, botPost } from '../services/botApi.js';
import {
  LEVEL,
  ROLE_LEVEL,
  ROLE_LABELS,
  CAPABILITIES,
  resolve,
  globalRole,
  invalidate,
} from '../services/capabilities.js';

/**
 * Route guards.
 *
 * These no longer decide anything themselves -- they resolve through
 * `services/capabilities.js` so a guard on a route and the lock drawn in the
 * sidebar come out of the same place. Every name that used to be exported here
 * is still exported, because eleven route modules import from this file.
 */

// Re-exported for the two callers that still reach for them (index.js, guilds.js).
export { ROLE_LABELS, roleTokenFromLevel } from '../services/capabilities.js';

/** @deprecated kept so `ROLE_HIERARCHY[role]` keeps working. Use ROLE_LEVEL. */
export const ROLE_HIERARCHY = Object.freeze({
  owner: LEVEL.OWNER,
  developer: LEVEL.OWNER,
  manager: LEVEL.MANAGER,
  admin: LEVEL.ADMIN,
  moderator: LEVEL.MODERATOR,
  support: LEVEL.SUPPORT,
  member: LEVEL.NONE,
  guest: LEVEL.NONE,
});

let botGuildCache = { ids: null, lastFetch: 0 };

export function clearBotGuildCache() {
  botGuildCache = { ids: null, lastFetch: 0 };
}
const CACHE_TTL = 300000;

const guildsRefreshCache = {};

/** Drop every cached decision about this user. Called when a role changes. */
export function clearDashboardRoleCache(userId) {
  if (userId) invalidate(userId);
}

/**
 * Mirror the user's best role into the session so views can show it.
 *
 * This is a display value. Nothing authorizes off it any more -- it used to be
 * what `canModify` and `checkPermission` compared against, which meant a
 * manager in one server inherited that authority in every other server.
 */
export async function refreshDashboardRole(req, res, next) {
  const user = req.session?.user;
  if (!user) return next();
  try {
    const { role } = await globalRole(user);
    if (role !== user.dashboardRole) user.dashboardRole = role;
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

// تحديث قائمة سيرفرات الجلسة من Discord (مقنّن كل 30 ثانية)
// يحل مشكلة إضافة البوت لسيرفر جديد بعد تسجيل الدخول: يُحدَّث المخزون فوراً
export async function refreshSessionGuilds(req) {
  const user = req.session?.user;
  if (!user?.refreshToken) return null;
  const now = Date.now();
  const last = guildsRefreshCache[user.id] || 0;
  if (now - last < 30000) return user.guilds || null;
  guildsRefreshCache[user.id] = now;
  try {
    const tokenData = await refreshToken(user.refreshToken);
    const freshGuilds = await getUserGuilds(tokenData.access_token);
    if (Array.isArray(freshGuilds) && freshGuilds.length > 0) {
      user.guilds = freshGuilds;
      user.accessToken = tokenData.access_token;
      user.refreshToken = tokenData.refresh_token;
      return freshGuilds;
    }
  } catch (e) {
    console.error('[refreshSessionGuilds]', e?.response?.data?.error_description || e?.message);
  }
  return null;
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

/**
 * Answer one permission question for this request.
 *
 * `guildId` comes from the route when the route is about one server. The
 * session's guild list can be stale, so a guild the user does not appear in
 * gets one refresh before we conclude anything.
 */
async function permsFor(req, guildId) {
  const user = req.session?.user;
  if (!user) return resolve(null, guildId);
  if (guildId && !(user.guilds || []).some(g => g.id === guildId)) {
    await refreshSessionGuilds(req);
  }
  return resolve(user, guildId);
}

function deny(req, res, message, apiMessage) {
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: apiMessage || message });
  }
  res.status(403).render('error', { layout: false, message, user: req.session?.user });
}

/** Effective level inside one guild. Per-guild only -- never a global best. */
export async function getGuildLevel(user, guildId) {
  const perms = await resolve(user, guildId);
  return perms.level;
}

export function clearGuildLevelCache(userId, guildId) {
  invalidate(userId, guildId);
}

/**
 * Require a role name ('manager') or a capability name ('modify').
 *
 * When the route carries a `:guildId`, the answer is scoped to that server. So
 * a moderator in guild A asking to change guild B is measured against guild B,
 * where they hold nothing.
 */
export function requireRole(minRole) {
  return async (req, res, next) => {
    const perms = await permsFor(req, req.params.guildId || req.query.guildId || null);
    const min = ROLE_LEVEL[minRole];
    const ok = min !== undefined
      ? perms.level >= min
      : (minRole in CAPABILITIES ? !!perms.can[minRole] : false);

    if (ok) return next();
    deny(req, res, 'ليس لديك صلاحيات لهذه المنطقة', 'ليس لديك صلاحيات لهذه المنطقة');
  };
}

/** Legacy name for a permission check. Same resolution, same answer. */
export function checkPermission(required) {
  return requireRole(required);
}

export function isOwner(req, res, next) {
  if (req.session?.user && req.session.user.id === config.discord.ownerId) {
    return next();
  }
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Owner only' });
  }
  res.redirect('/access-denied?reason=owner');
}

/**
 * The developer gate. This is the whole of `roleLevel >= 4` in the old sidebar:
 * the bot owner, plus anyone in the BotDeveloper table. A developer gets the
 * dev panel and nothing over anyone's server.
 */
export function isOwnerOrDeveloper(req, res, next) {
  if (req.session?.user?.id === config.discord.ownerId) return next();
  if (req.perms?.isDeveloper) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'لوحة المطور للمطورين فقط' });
  }
  res.redirect('/access-denied?reason=developer');
}

export async function hasGuildAccess(req, res, next) {
  try {
    const guildId = req.params.guildId || req.query.guildId;
    if (!guildId) return res.status(400).json({ error: 'Guild ID required' });

    const perms = await permsFor(req, guildId);
    // A real foothold: an Admin record for this server, or admin rights in it.
    // Not "some admin record somewhere", which is what this used to accept.
    if (!perms.inGuild) {
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'No access to this guild' });
      }
      return res.redirect('/access-denied?reason=guild');
    }

    let botIds = await getBotGuildIds();
    if (botIds && !botIds.has(guildId)) {
      // قد يكون البوت أُضيف للسيرفر للتو — استعلم مباشرة من البوت (بدون كاش)
      try {
        const botRes = await botFetch(`${config.botApiUrl}/api/guilds`, {
          signal: AbortSignal.timeout(4000),
        }).catch(() => null);
        if (botRes && botRes.ok) {
          const data = await botRes.json();
          if (Array.isArray(data?.guilds)) {
            botIds = new Set(data.guilds.map(String));
            botGuildCache = { ids: botIds, lastFetch: Date.now() };
          }
        }
      } catch {}
    }
    if (botIds && !botIds.has(guildId)) {
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'البوت غير موجود في هذا السيرفر', detail: 'أضف البوت إلى السيرفر أولاً' });
      }
      return res.status(404).render('error', { layout: false, message: 'البوت غير موجود في هذا السيرفر. أضف البوت أولاً.', user: req.session.user });
    }
    next();
  } catch (err) {
    console.error('[hasGuildAccess Error]', err);
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(500).json({ error: 'Internal error checking guild access' });
    }
    res.status(500).render('error', { layout: false, message: 'خطأ أثناء التحقق من صلاحية السيرفر.', user: req.session?.user });
  }
}

/**
 * Write access. Scoped to `:guildId` when the route names a server -- this used
 * to compare the session's global role, so the sidebar lock was a lie.
 */
export function canModify(req, res, next) {
  return requireRole('modify')(req, res, next);
}

export async function isOwnerOrAdmin(req, res, next) {
  if (req.session?.user?.id === config.discord.ownerId) return next();
  const adminCount = await Admin.countDocuments({ userId: req.session?.user?.id });
  if (adminCount > 0) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Owner or admin only' });
  }
  res.redirect('/access-denied?reason=owner');
}

// ─── Premium status (sidebar dot) ─────────────────────────────────────────
// Not a permission. Cached briefly because the sidebar asks on every guild
// page and it is a pair of config reads.
const premiumStatusCache = new Map();
const PREMIUM_STATUS_TTL = 10000; // 10 ثوانٍ

export function clearPremiumStatusCache(guildId) {
  if (guildId) premiumStatusCache.delete(guildId);
  else premiumStatusCache.clear();
}

export async function getGuildPremium(guildId) {
  if (!guildId) return { active: false, planId: null, planLabel: null };
  const now = Date.now();
  const cached = premiumStatusCache.get(guildId);
  if (cached && now - cached.ts < PREMIUM_STATUS_TTL) return cached.data;

  let data = { active: false, planId: null, planLabel: null };
  try {
    const planCfg = await getGuildConfig(guildId, 'premium_plan');
    const endCfg = await getGuildConfig(guildId, 'premium_expires_at');
    const planId = planCfg?.value || null;
    const expiresAt = endCfg?.value ? Number(endCfg.value) : null;

    let active = false;
    if (planId && (!expiresAt || expiresAt > now)) active = true;
    data = {
      active,
      planId: active ? planId : null,
      planLabel: active ? (planId === 'ultimate' ? 'Ultimate' : planId === 'standard' ? 'Standard' : planId) : null,
    };
  } catch {}
  premiumStatusCache.set(guildId, { data, ts: now });
  return data;
}