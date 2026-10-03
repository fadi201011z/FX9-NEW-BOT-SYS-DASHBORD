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
export const LEVEL = Object.freeze({
  NONE: -1,
  SUPPORT: 0,
  MODERATOR: 1,
  ADMIN: 2,
  MANAGER: 3,
  OWNER: 4,
});

/** The roles a guild admin can be appointed to. */
export const ROLE_LEVEL = Object.freeze({
  support: LEVEL.SUPPORT,
  moderator: LEVEL.MODERATOR,
  admin: LEVEL.ADMIN,
  manager: LEVEL.MANAGER,
});

export const ROLE_LABELS = Object.freeze({
  owner: 'المالك',
  manager: 'مدير',
  admin: 'آدمن',
  moderator: 'مشرف',
  support: 'دعم',
  member: 'عضو',
});

/**
 * The whole permission vocabulary: minimum level per capability. The keys are
 * what routes and templates ask for. Keep this map the only place a number
 * gets compared -- adding a capability here is how you add one anywhere.
 */
export const CAPABILITIES = Object.freeze({
  guilds: LEVEL.SUPPORT,
  tickets: LEVEL.SUPPORT,
  logs: LEVEL.MODERATOR,
  notifications: LEVEL.MODERATOR,
  voice: LEVEL.MODERATOR,
  settings: LEVEL.ADMIN,
  commands: LEVEL.ADMIN,
  protection: LEVEL.ADMIN,
  premium: LEVEL.ADMIN,
  dashboard: LEVEL.MANAGER,
  admins: LEVEL.MANAGER,
  backup: LEVEL.MANAGER,
  modify: LEVEL.MANAGER,
});

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
  if (level >= LEVEL.MODERATOR) return 'moderator';
  if (level >= LEVEL.SUPPORT) return 'support';
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