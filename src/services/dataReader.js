import fs from 'fs';
import path from 'path';
import config from '../config.js';

const DATA_DIR = config.dataPath;

export function readJsonFile(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {}
  return {};
}

export function getGuildTickets(guildId) {
  const all = readJsonFile('fx9_data.json');
  const tickets = all.tickets || {};
  const guildTickets = Object.values(tickets).filter(t => t.guildId === guildId);
  return {
    open: guildTickets.filter(t => t.status === 'open'),
    closed: guildTickets.filter(t => t.status === 'closed'),
    total: guildTickets.length,
  };
}

export function getTotalTicketCount() {
  const all = readJsonFile('fx9_data.json');
  return Object.keys(all.tickets || {}).length;
}

export function getGuildVoiceChannels(guildId) {
  const all = readJsonFile('active_channels.json');
  return Object.entries(all)
    .filter(([, vc]) => vc && vc.guildId === guildId)
    .map(([vcId, vc]) => ({ ...vc, vcId }));
}

export function getTicketGuildConfig(guildId) {
  const all = readJsonFile('fx9_data.json');
  const guildCfg = (all.guilds || {})[guildId];
  if (!guildCfg) return null;
  return {
    ticketCategoryId: guildCfg.ticketCategoryId || '',
    adminCategoryId: guildCfg.adminCategoryId || '',
    panelChannelId: guildCfg.panelChannelId || '',
    logChannelId: guildCfg.logChannelId || '',
    supportRoleIds: guildCfg.supportRoleIds || [],
    ticketCounter: guildCfg.ticketCounter || 0,
  };
}

export function saveTicketGuildConfig(guildId, updates) {
  const filePath = path.join(DATA_DIR, 'fx9_data.json');
  let all = {};
  try {
    if (fs.existsSync(filePath)) all = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {}
  if (!all.guilds) all.guilds = {};
  if (!all.guilds[guildId]) all.guilds[guildId] = { guildId, supportRoleIds: [], ticketCounter: 0 };
  Object.assign(all.guilds[guildId], updates);
  fs.writeFileSync(filePath, JSON.stringify(all, null, 2), 'utf-8');
}
