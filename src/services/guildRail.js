/**
 * The server rail's rows, and the list /home shares with them.
 *
 * One rule decides who appears in the rail and whether their row is a link, and
 * it lives here rather than in the template so the rail and /home cannot end up
 * disagreeing about which servers exist. That rule is the one `hasGuildAccess`
 * applies to a server path: a Discord administrator or guild manager (0x8/0x20)
 * OR an Admin record appointed from /admins. The record half used to be dropped
 * here, which is why someone handed a rank in المدراء could open the server from
 * /guilds and /home but never saw a row for it in the rail.
 */
import config from '../config.js';
import { botFetch } from './botApi.js';
import { getUserAdminGuilds } from '../database.js';
import { levelFromDiscordPermissions, ROLE_LEVEL, LEVEL } from './capabilities.js';

/* The bot's guild set is the same for everyone, so it is cached once for the
   process instead of per user. 30s because a server being added, or the bot
   being kicked, is not urgent -- and this runs on every request. */
const BOT_GUILDS_TTL = 30_000;
let botGuildCache = null;

/**
 * The ids of every server the bot is in, or null when the bot API could not be
 * reached. Null and empty are different answers and the difference matters: an
 * empty set would mark every server as botless and lock the whole rail, so an
 * unreachable API answers "unknown" and lets every row through. The routes still
 * check for real, so a wrong yes here costs a redirect and nothing more.
 */
export async function botGuildIds() {
  const now = Date.now();
  if (botGuildCache && now - botGuildCache.ts < BOT_GUILDS_TTL) return botGuildCache.ids;

  let ids = null;
  try {
    // 2.5s, not the 4s /home uses: this one sits on the critical path of every
    // page render, and a bot that is down must not hold the shell hostage.
    const res = await botFetch('/api/guilds', { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error('bot api status ' + res.status);
    const data = await res.json();
    ids = new Set((Array.isArray(data.guilds) ? data.guilds : []).map(String));
  } catch {}

  // The failure is cached too. Without this an unreachable bot API costs a 2.5s
  // timeout on every single request for as long as it stays unreachable, which
  // is a slower dashboard than the one thing the cache is meant to protect.
  botGuildCache = { ids, ts: now };
  return ids;
}

/**
 * Every server this person administers, as the session sees them, each one
 * carrying the level they hold in it.
 *
 * "Administers" is the same answer `hasGuildAccess` gives for a single server:
 * a Discord administrator (0x8) or guild manager (0x20), OR an Admin record
 * appointed from /admins. /guilds already reads both halves; the rail and /home
 * run that same pair of tests here so neither can answer it more weakly.
 *
 * The owner is exempt from the record half only, exactly like /guilds. resolve()
 * grants the owner LEVEL.OWNER everywhere, but that is a statement about the
 * bot, not about the servers they merely happen to be a member of -- and a rail
 * with two different filters in it is not a filter.
 */
export async function manageableGuilds(user) {
  if (!user) return [];

  const adminRoles = new Map();
  if (user.id !== config.discord.ownerId) {
    try {
      const rows = await getUserAdminGuilds(user.id);
      for (const row of rows || []) adminRoles.set(String(row.guildId), row.role);
    } catch {}
  }

  return (user.guilds || [])
    .filter(g => {
      const id = String(g.id);
      return levelFromDiscordPermissions(g.permissions) >= LEVEL.MANAGER || adminRoles.has(id);
    })
    .map(g => {
      const id = String(g.id);
      const fromDiscord = levelFromDiscordPermissions(g.permissions);
      const fromRecord = ROLE_LEVEL[adminRoles.get(id)] ?? LEVEL.NONE;
      return { ...g, myLevel: Math.max(fromDiscord, fromRecord) };
    });
}

/**
 * The rail's rows: the same set, narrowed to what a row needs.
 *
 * The order is the session's, not sorted. /home sorts its own copy by bot-first
 * then rank, because it is a page whose first card is an answer; a rail is a
 * switcher, and a switcher that reorders itself between pages makes the same
 * server sit in a different place each time with no reason the eye can find.
 */
export async function railGuilds(user, botIds) {
  const list = await manageableGuilds(user);

  return list.map(g => {
    const id = String(g.id);
    return {
      id,
      name: g.name || 'سيرفر',
      icon: g.icon || null,
      inBot: botIds === null ? true : botIds.has(id),
    };
  });
}

export default { botGuildIds, manageableGuilds, railGuilds };
