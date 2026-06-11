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

export async function getGuildRoles(guildId, botToken) {
  const res = await axios.get(`https://discord.com/api/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
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
    const res = await axios.get(`https://discord.com/api/guilds/${guildId}/members?limit=1000`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    const members = res.data || [];
    return members.filter(m => m.roles && m.roles.includes(roleId));
  } catch {
    return [];
  }
}

export function getInviteUrl() {
  return `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;
}

export function getSupportedGuilds(userGuilds, botGuilds) {
  const botGuildIds = new Set(botGuilds.map(g => g.id));
  return userGuilds.filter(g => botGuildIds.has(g.id)).map(g => ({
    ...g,
    botIn: true,
  }));
}
