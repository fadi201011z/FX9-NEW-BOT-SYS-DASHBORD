import axios from 'axios';
import config from '../config.js';

const CLIENT_ID = config.discord.clientId;
const CLIENT_SECRET = config.discord.clientSecret;
const CALLBACK_URL = config.discord.callbackUrl;

export function getAuthUrl() {
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', CALLBACK_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.discord.scopes.join(' '));
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export async function exchangeCode(code) {
  const data = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: CALLBACK_URL,
  });

  const res = await axios.post('https://discord.com/api/oauth2/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return res.data;
}

export async function refreshToken(refreshToken) {
  const data = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await axios.post('https://discord.com/api/oauth2/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return res.data;
}

export async function getUserInfo(accessToken) {
  const res = await axios.get('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}

export async function getUserGuilds(accessToken) {
  const res = await axios.get('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}

export async function getDiscordUser(userId, botToken) {
  try {
    const res = await axios.get(`https://discord.com/api/users/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    return res.data;
  } catch {
    return null;
  }
}

const rolesCache = new Map();
const ROLES_CACHE_TTL = 300000;

export async function getGuildRoles(guildId, botToken) {
  const cached = rolesCache.get(guildId);
  if (cached && Date.now() - cached.ts < ROLES_CACHE_TTL) return cached.data;
  const res = await axios.get(`https://discord.com/api/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  rolesCache.set(guildId, { data: res.data, ts: Date.now() });
  return res.data;
}

export async function getGuildMember(guildId, userId, botToken) {
  try {
    const res = await axios.get(`https://discord.com/api/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    return res.data;
  } catch {
    return null;
  }
}

export async function getBotGuilds(botToken) {
  const res = await axios.get('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bot ${botToken}` },
  });
  return res.data;
}

export async function getGuildInfo(guildId, botToken) {
  try {
    const res = await axios.get(`https://discord.com/api/guilds/${guildId}?with_counts=true`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    return res.data;
  } catch {
    return null;
  }
}

export async function getGuildChannels(guildId, botToken) {
  try {
    const res = await axios.get(`https://discord.com/api/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    return res.data || [];
  } catch {
    return [];
  }
}

export async function getGuildMembersByRole(guildId, roleId, botToken) {
  try {
    const allMembers = await getAllGuildMembersPaginated(guildId, botToken);
    return allMembers.filter(m => m.roles && m.roles.includes(roleId));
  } catch {
    return [];
  }
}

export async function getAllGuildMembersPaginated(guildId, botToken) {
  // Try bot API first (uses Gateway fetch = all members)
  try {
    const res = await fetch(`${config.botApiUrl}/api/guilds/${guildId}/members`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 1) {
        console.log(`[BotAPI] Got ${data.length} members for guild ${guildId}`);
        return data.map(m => ({
          user: { id: m.id, username: m.username, avatar: m.avatar },
          roles: m.roles,
        }));
      }
    }
  } catch {}
  // Fallback: Discord REST API (limited, but better than nothing)
  console.log(`[DiscordAPI] Fetching all members for guild ${guildId} (REST fallback)...`);
  let members = [];
  let lastId = null;
  for (let i = 0; i < 10; i++) {
    let url = `https://discord.com/api/guilds/${guildId}/members?limit=1000`;
    if (lastId) url += `&after=${lastId}`;
    const res = await axios.get(url, { headers: { Authorization: `Bot ${botToken}` } });
    const batch = res.data || [];
    if (batch.length === 0) break;
    members = members.concat(batch);
    console.log(`[DiscordAPI]  Fetched ${batch.length} members (page ${i + 1}, total ${members.length})`);
    if (batch.length < 1000) break;
    lastId = batch[batch.length - 1].user.id;
  }
  console.log(`[DiscordAPI] Done: ${members.length} total members for guild ${guildId}`);
  return members;
}

export function getInviteUrl() {
  return '/maintenance';
}

// ─── Bot API helpers (cache-first, fallback to Discord API) ─────────────

export async function fetchBotMembers(guildId) {
  const res = await fetch(`${config.botApiUrl}/api/guilds/${guildId}/members`);
  if (!res.ok) throw new Error('Bot API failed');
  return res.json();
}

export async function fetchBotMembersByRoles(guildId, roleIds) {
  const query = roleIds.length ? `?roleIds=${roleIds.join(',')}` : '';
  const res = await fetch(`${config.botApiUrl}/api/guilds/${guildId}/members-by-roles${query}`);
  if (!res.ok) throw new Error('Bot API failed');
  return res.json();
}

export async function fetchBotUser(userId) {
  const res = await fetch(`${config.botApiUrl}/api/users/${userId}`);
  if (!res.ok) return null;
  return res.json();
}

export function getSupportedGuilds(userGuilds, botGuilds) {
  const botGuildIds = new Set(botGuilds.map(g => g.id));
  return userGuilds.filter(g => botGuildIds.has(g.id)).map(g => ({
    ...g,
    botIn: true,
  }));
}
