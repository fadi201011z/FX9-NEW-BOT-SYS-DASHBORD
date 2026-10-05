/**
 * The server rail's rows.
 *
 * One rule decides who appears in the rail and whether their row is a link, and
 * it lives here rather than in the template so the rail and /home cannot end up
 * disagreeing about which servers exist. /home ran this same filter inline --
 * `permissions & 0x8 || permissions & 0x20` -- and it is now levelFromDiscord
 * Permissions, the one Discord permission reader the guards also use.
 */
import { botFetch } from './botApi.js';
import { levelFromDiscordPermissions, LEVEL } from './capabilities.js';

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
 * Every server this person administers, flagged with whether the bot is in it.
 *
 * One filter, and it is the same one `resolve()` ends up applying to a server
 * path: a Discord administrator (0x8) or a guild manager (0x20) is at least
 * LEVEL.MANAGER, which is what /guilds/<id> asks for. The rail therefore lists
 * exactly the servers a row in it would let you open, and never one that would
 * bounce.
 *
 * No exemption for `perms.isOwner`, which is the whole point of the last change.
 * resolve() does grant the bot's owner LEVEL.OWNER everywhere, so the exemption
 * was defensible as a guard input -- but the owner of a bot is not an
 * administrator of every server they happen to be a member of, and a switcher
 * that answers "everything I am in" for one person and "what I administer" for
 * everyone else is not a filter, it is two filters wearing one column. It was
 * also the only thing widening this rail past the guard's own set.
 *
 * Session guild order is kept rather than sorted -- /guilds and /home present
 * the same list in the same order, and a rail that reorders on its own makes the
 * same server sit in three different places.
 */
export function railGuilds(user, botIds) {
  if (!user) return [];

  const list = (user.guilds || [])
    .filter(g => levelFromDiscordPermissions(g.permissions) >= LEVEL.MANAGER);

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

export default { botGuildIds, railGuilds };
