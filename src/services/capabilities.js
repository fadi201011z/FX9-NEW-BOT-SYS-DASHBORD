import config from '../config.js';
import Admin from '../models/Admin.js';
import BotDeveloper from '../models/BotDeveloper.js';

/**
 * Every permission decision in the dashboard resolves through this module.
 *
 * The point: a lock drawn in a template and a guard run on a route read the
 * SAME object for the SAME request, so they cannot disagree. Before this
 * existed the sidebar used a per-guild level while `canModify` and
 * `checkPermission` used a single global one, which left the locks cosmetic --
 * a manager in guild A could pass `canModify` on guild B where they were only
 * support, simply by calling the endpoint.
 */

// ── Levels ────────────────────────────────────────────────────────────────
// ستّ رتب إدارية داخل السيرفر (بعد مالك البوت)، كل رتبة أرفع من التي تليها.
export const LEVEL = Object.freeze({
  NONE: -1,
  VIEWER: 0,
  SUPPORT: 1,
  MODERATOR: 2,
  SUPERVISOR: 3,
  ADMIN: 4,
  MANAGER: 5,
  OWNER: 6,
});

/** الرتب الست التي يمكن تعيين مدراء السيرفر عليها، من الأدنى إلى الأعلى. */
export const ADMIN_ROLES = Object.freeze([
  'viewer', 'support', 'moderator', 'supervisor', 'admin', 'manager',
]);

/** The roles a guild admin can be appointed to. */
export const ROLE_LEVEL = Object.freeze({
  viewer: LEVEL.VIEWER,
  support: LEVEL.SUPPORT,
  moderator: LEVEL.MODERATOR,
  supervisor: LEVEL.SUPERVISOR,
  admin: LEVEL.ADMIN,
  manager: LEVEL.MANAGER,
});

export const ROLE_LABELS = Object.freeze({
  owner: 'المالك',
  manager: 'مدير',
  admin: 'آدمن',
  supervisor: 'مشرف أول',
  moderator: 'مشرف',
  support: 'دعم',
  viewer: 'مراقب',
  member: 'عضو',
});

/**
 * The whole permission vocabulary: minimum level per capability. The keys are
 * what routes and templates ask for. Keep this map the only place a number
 * gets compared -- adding a capability here is how you add one anywhere.
 */
export const CAPABILITIES = Object.freeze({
  guilds: LEVEL.VIEWER,
  tickets: LEVEL.SUPPORT,
  logs: LEVEL.MODERATOR,
  voice: LEVEL.MODERATOR,
  notifications: LEVEL.SUPERVISOR,
  settings: LEVEL.ADMIN,
  commands: LEVEL.ADMIN,
  protection: LEVEL.ADMIN,
  premium: LEVEL.ADMIN,
  dashboard: LEVEL.MANAGER,
  admins: LEVEL.MANAGER,
  backup: LEVEL.MANAGER,
  modify: LEVEL.MANAGER,
});

/**
 * The capability vocabulary in words, for the admin/permissions screens. Kept
 * next to CAPABILITIES so a new capability can never be granted without also
 * having a name a server owner can read.
 */
export const CAPABILITY_LABELS = Object.freeze({
  guilds: 'قائمة السيرفرات والنظرة العامة',
  tickets: 'نظام التذاكر والدعم',
  logs: 'سجل النشاط',
  voice: 'الرومات الصوتية المؤقتة',
  notifications: 'الإشعارات والإمبد',
  settings: 'إعدادات السيرفر',
  commands: 'إدارة الأوامر والصلاحيات',
  protection: 'أنظمة الحماية والتصفية',
  premium: 'نظام البريميوم',
  admins: 'إدارة المدراء والرتب',
  backup: 'النسخ الاحتياطي',
  dashboard: 'لوحة التحكم الرئيسية',
  modify: 'صلاحية التعديل على السيرفر',
});

/**
 * The six ranks a server owner hands out, described once. The /admins page draws
 * its cards and its details modal straight off this array, and `permissions` is
 * computed from CAPABILITIES -- so the page can never advertise a permission the
 * guard would not actually hand out.
 */
export const ROLE_CATALOG = Object.freeze([
  {
    id: 'manager', label: 'مدير', en: 'Manager', level: LEVEL.MANAGER,
    icon: 'crown', color: '#ffcf5c',
    tagline: 'صلاحية كاملة على كل صفحات السيرفر',
    description: 'أعلى رتبة إدارية في السيرفر بعد مالك البوت. تتحكم في كل شيء: الإعدادات، الأوامر، الحماية، المدراء، النسخ الاحتياطي والبريميوم.',
  },
  {
    id: 'admin', label: 'آدمن', en: 'Admin', level: LEVEL.ADMIN, icon: 'user-shield', color: '#d000ff',
    tagline: 'تحكم في الإعدادات والحماية والأوامر',
    description: 'تدير الجانب التقني للسيرفر: الإعدادات، نظام الأوامر، أنظمة الحماية والبريميوم — دون الوصول إلى إدارة المدراء أو النسخ الاحتياطي.',
  },
  {
    id: 'supervisor', label: 'مشرف أول', en: 'Supervisor', level: LEVEL.SUPERVISOR, icon: 'user-tie', color: '#00c8ff',
    tagline: 'إشراف كامل على الإشراف والتنبيهات',
    description: 'رتبة إشرافية أعلى: تتابع سجل النشاط والرومات الصوتية وتدير الإشعارات والإمبد، مع صلاحيات الإشراف والتذاكر.',
  },
  {
    id: 'moderator', label: 'مشرف', en: 'Moderator', level: LEVEL.MODERATOR, icon: 'gavel', color: '#ffb020',
    tagline: 'إدارة الرومات الصوتية والسجلات',
    description: 'يشرف على الرومات الصوتية المؤقتة ويطّلع على سجل النشاط، ويساعد في التذاكر — بدون الوصول إلى الإعدادات.',
  },
  {
    id: 'support', label: 'دعم', en: 'Support', level: LEVEL.SUPPORT, icon: 'headset', color: '#00e0a4',
    tagline: 'فريق الدعم ونظام التذاكر',
    description: 'مسؤول الدعم الفني: يستقبل التذاكر ويرد عليها ويغلقها، ويرى قائمة السيرفرات فقط.',
  },
  {
    id: 'viewer', label: 'مراقب', en: 'Viewer', level: LEVEL.VIEWER, icon: 'eye', color: '#9aa0b5',
    tagline: 'اطّلاع فقط دون أي تعديل',
    description: 'رتبة للقراءة فقط: يمكنه فتح اللوحة ومعاينة النظرة العامة وحالة السيرفر، دون أي صلاحية تعديل أو إجراء.',
  },
]);

/** Capability keys a given level is granted, in CAPABILITIES order. */
export function capabilitiesForLevel(level) {
  return Object.keys(CAPABILITIES).filter((name) => level >= CAPABILITIES[name]);
}

export function levelOf(role) {
  return ROLE_LEVEL[role] ?? LEVEL.NONE;
}

export function isValidAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

/** Highest admin role out of a list of role names (null when none qualify). */
export function bestRole(roleList) {
  let best = null;
  let bestLevel = LEVEL.NONE;
  for (const role of roleList || []) {
    const l = levelOf(role);
    if (l > bestLevel) { bestLevel = l; best = role; }
  }
  return best;
}

// ── Discord permission bits ───────────────────────────────────────────────
const PERM_ADMINISTRATOR = 0x8n;
const PERM_MANAGE_GUILD = 0x20n;

/**
 * A Discord administrator or guild manager sits in the same tier as an
 * appointed manager. This has to be true here and in `resolve`, otherwise a
 * guild admin with no Admin record gets shown a lock they can act past.
 */
export function levelFromDiscordPermissions(perms) {
  if (perms === undefined || perms === null) return LEVEL.NONE;
  try {
    const p = BigInt(perms);
    if ((p & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return LEVEL.MANAGER;
    if ((p & PERM_MANAGE_GUILD) === PERM_MANAGE_GUILD) return LEVEL.MANAGER;
  } catch {}
  return LEVEL.NONE;
}

const CI = { collation: { locale: 'en', strength: 2 } };

// ── Bounded cache ─────────────────────────────────────────────────────────
// Permission checks run on every request, and two indexed reads per request is
// a lot to pay for a number that changes twice a day. Cached for 30s and held
// to a fixed size: the old cache was unbounded, so a busy day grew it without
// limit until the next deploy cleared it.

const CACHE_TTL = 30_000;
const CACHE_MAX = 2000;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  // refresh recency so eviction is least-recently-used, not insertion-order
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.has(key)) cache.delete(key);
  while (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, { value, ts: Date.now() });
}

/** Drop cached decisions. Called whenever a role actually changes. */
export function invalidate(userId, guildId) {
  if (!userId) return cache.clear();
  if (guildId) {
    cache.delete(`perm:${userId}:${guildId}`);
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(userId)) cache.delete(key);
  }
}

// ── Is this person a bot developer? ───────────────────────────────────────
// Owners are developers by definition, so they never need a row.
export async function isBotDeveloper(userId) {
  if (!userId) return false;
  if (userId === config.discord.ownerId) return true;
  const key = `dev:${userId}`;
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  let found = false;
  try {
    found = !!(await BotDeveloper.exists({ userId }));
  } catch {
    found = false;
  }
  cacheSet(key, found);
  return found;
}

// ── Best role across every guild ───────────────────────────────────────────
// This is a DISPLAY number (the dashboard header, the guild picker). It is
// deliberately not an authorization input: "best role somewhere" has no say in
// what you may do in a specific server.
export async function globalRole(user) {
  if (!user) return { role: 'guest', level: LEVEL.NONE };
  if (user.id === config.discord.ownerId) return { role: 'owner', level: LEVEL.OWNER };

  const key = `global:${user.id}`;
  const hit = cacheGet(key);
  if (hit !== null) return hit;

  let role = 'member';
  let level = LEVEL.NONE;
  try {
    const rows = await Admin.find({ userId: user.id }).collation(CI.collation).lean();
    for (const row of rows) {
      const l = ROLE_LEVEL[row.role] ?? LEVEL.NONE;
      if (l > level) { level = l; role = row.role; }
    }
  } catch {}
  // Discord's own say, across every server the user is in. Without this a
  // server administrator who was never appointed an Admin record ranks as a
  // plain member and cannot even open the server list.
  for (const g of user.guilds || []) {
    const l = levelFromDiscordPermissions(g.permissions);
    if (l > level) { level = l; role = 'manager'; }
  }

  const out = { role, level };
  cacheSet(key, out);
  return out;
}

export function roleTokenFromLevel(level) {
  if (level >= LEVEL.OWNER) return 'owner';
  if (level >= LEVEL.MANAGER) return 'manager';
  if (level >= LEVEL.ADMIN) return 'admin';
  if (level >= LEVEL.SUPERVISOR) return 'supervisor';
  if (level >= LEVEL.MODERATOR) return 'moderator';
  if (level >= LEVEL.SUPPORT) return 'support';
  if (level >= LEVEL.VIEWER) return 'viewer';
  return 'member';
}

function buildCan(level, isOwner, isDeveloper) {
  const can = {};
  for (const [name, min] of Object.entries(CAPABILITIES)) can[name] = level >= min;
  if (isOwner) for (const name of Object.keys(can)) can[name] = true;
  // A developer gets the bot's dev panel. It grants nothing over a guild --
  // that would make every developer an admin of everyone's server.
  can.dev = isOwner || isDeveloper;
  can.manageDevelopers = isOwner;
  return Object.freeze(can);
}

const GUEST = Object.freeze({
  userId: null,
  isOwner: false,
  isDeveloper: false,
  inGuild: false,
  guildId: null,
  level: LEVEL.NONE,
  role: 'guest',
  roleLabel: ROLE_LABELS.member,
  can: buildCan(LEVEL.NONE, false, false),
});

/**
 * Resolve everything the current request is allowed to do.
 *
 * `guildId` scopes the answer to one server. Pass null for the site-wide
 * answer. One call, one object; middleware and templates share it.
 */
export async function resolve(user, guildId = null) {
  if (!user) return GUEST;

  const isOwner = user.id === config.discord.ownerId;
  const isDeveloper = await isBotDeveloper(user.id);
  const key = `perm:${user.id}:${guildId || '-'}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  let level = LEVEL.NONE;
  let role = 'member';
  let inGuild = false;

  if (isOwner) {
    level = LEVEL.OWNER;
    role = 'owner';
    inGuild = true;
  } else if (guildId) {
    try {
      const row = await Admin.findOne({ userId: user.id, guildId }).collation(CI.collation).lean();
      if (row) {
        level = ROLE_LEVEL[row.role] ?? LEVEL.NONE;
        role = row.role;
        inGuild = true;
      }
    } catch {}
    const g = (user.guilds || []).find(x => x.id === guildId);
    const fromDiscord = levelFromDiscordPermissions(g && g.permissions);
    if (fromDiscord > LEVEL.NONE) inGuild = true;
    if (fromDiscord > level) { level = fromDiscord; role = 'manager'; }
  } else {
    const g = await globalRole(user);
    level = g.level;
    role = g.role;
    inGuild = level > LEVEL.NONE;
  }

  const perms = Object.freeze({
    userId: user.id,
    isOwner,
    isDeveloper,
    inGuild,
    guildId: guildId || null,
    level,
    role,
    roleLabel: ROLE_LABELS[role] || ROLE_LABELS.member,
    can: buildCan(level, isOwner, isDeveloper),
  });

  cacheSet(key, perms);
  return perms;
}