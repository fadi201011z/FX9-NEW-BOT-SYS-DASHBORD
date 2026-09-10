import config from '../config.js';
import { getGuild } from '../auth/discord.js';

export async function resolveGuild(userGuilds, guildId) {
  const fromSession = (userGuilds || []).find(g => g.id === guildId);
  if (fromSession) return fromSession;

  try {
    const res = await fetch(`${config.botApiUrl}/api/guilds/${guildId}/info`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return await res.json();
  } catch {}

  try {
    const g = await getGuild(guildId);
    if (g && g.id) return { id: g.id, name: g.name || guildId, icon: g.icon || null, permissions: '0' };
  } catch {}

  return null;
}