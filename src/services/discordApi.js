import axios from 'axios';
import config from '../config.js';

const BOT_TOKEN = config.discord.botToken;
const BASE = 'https://discord.com/api/v10';

export async function getGuild(guildId) {
  try {
    const res = await axios.get(`${BASE}/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return res.data;
  } catch { return null; }
}

export async function getGuildChannels(guildId) {
  try {
    const res = await axios.get(`${BASE}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return res.data;
  } catch { return []; }
}

export async function getGuildRoles(guildId) {
  try {
    const res = await axios.get(`${BASE}/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return res.data;
  } catch { return []; }
}

export async function getGuildMember(guildId, userId) {
  try {
    const res = await axios.get(`${BASE}/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return res.data;
  } catch { return null; }
}

export async function getGuildMembers(guildId, limit = 1000) {
  try {
    const res = await axios.get(`${BASE}/guilds/${guildId}/members?limit=${limit}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return res.data;
  } catch { return []; }
}

export async function getGuildBans(guildId) {
  try {
    const res = await axios.get(`${BASE}/guilds/${guildId}/bans`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return res.data;
  } catch { return []; }
}

export async function getUser(userId) {
  try {
    const res = await axios.get(`${BASE}/users/${userId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    return res.data;
  } catch { return null; }
}

export function getAvatarUrl(user) {
  if (!user) return '/images/default-avatar.png';
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}`;
  }
  const defaultIndex = parseInt(user.discriminator || '0') % 5;
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

export function getGuildIconUrl(guild) {
  if (!guild || !guild.icon) return '/images/default-guild.png';
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${guild.icon.startsWith('a_') ? 'gif' : 'png'}`;
}
