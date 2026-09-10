import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { getGuildConfig, setGuildConfig, getAllGuildConfig, deleteGuildConfig, logAudit, logActivity } from '../database.js';
import { getTicketGuildConfig, saveTicketGuildConfig } from '../services/dataReader.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildChannels, getGuildRoles } from '../auth/discord.js';
import config from '../config.js';
import { resolveGuild } from '../services/guildResolver.js';

const TICKET_KEY_MAP = {
  ticket_category: 'ticketCategoryId',
  admin_category: 'adminCategoryId',
  panel_channel: 'panelChannelId',
  log_channel_id: 'logChannelId',
};

const router = Router();

async function fetchGuildChannels(guildId) {
  try {
    const res = await fetch(`${config.botApiUrl}/api/guilds/${guildId}/channels`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  try {
    return await getGuildChannels(guildId, config.discord.botToken);
  } catch {}
  return [];
}

async function fetchGuildRoles(guildId) {
  try {
    const res = await fetch(`${config.botApiUrl}/api/guilds/${guildId}/roles`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  try {
    return await getGuildRoles(guildId, config.discord.botToken);
  } catch {}
  return [];
}

async function buildViewData(guildId) {
  const cfg = await getAllGuildConfig(guildId);
  const ticketJson = await getTicketGuildConfig(guildId);
  if (ticketJson) {
    cfg.ticket_category = ticketJson.ticketCategoryId || (cfg.ticket_category || '');
    cfg.admin_category = ticketJson.adminCategoryId || (cfg.admin_category || '');
    cfg.panel_channel = ticketJson.panelChannelId || (cfg.panel_channel || '');
    cfg.log_channel_id = ticketJson.logChannelId || (cfg.log_channel_id || '');
    cfg.support_role = ticketJson.supportRoleIds.length ? ticketJson.supportRoleIds.join(', ') : (cfg.support_role || '');
    cfg.ticket_counter = ticketJson.ticketCounter || cfg.ticket_counter || 0;
  }

  let supportRoleArray = [];
  if (cfg.support_role) {
    supportRoleArray = String(cfg.support_role).split(',').map(s => s.trim()).filter(Boolean);
  }

  const channels = { text: [], voice: [], category: [] };
  const allChannels = await fetchGuildChannels(guildId);
  for (const c of allChannels) {
    if (c.type === 0 || c.type === 5) channels.text.push({ id: c.id, name: c.name });
    else if (c.type === 2) channels.voice.push({ id: c.id, name: c.name });
    else if (c.type === 4) channels.category.push({ id: c.id, name: c.name });
  }

  let roles = await fetchGuildRoles(guildId);
  roles.sort((a, b) => (b.position || 0) - (a.position || 0));

  return { config: cfg, supportRoleArray, channels, roles };
}

async function syncConfigToBot() {
  try {
    const res = await fetch(`${config.botApiUrl}/api/sync-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return true;
  } catch {}
  return false;
}

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  const { guildId } = req.params;
  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });
  const data = await buildViewData(guildId);

  res.render('guild/settings', {
    user: req.session.user,
    guild,
    config: data.config,
    supportRoleArray: data.supportRoleArray,
    channels: data.channels,
    roles: data.roles,
    title: 'الإعدادات',
  });
});

router.post('/:guildId/save', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const settings = req.body.settings || req.body;
    let changed = 0;

    for (const [key, rawValue] of Object.entries(settings)) {
      if (key === 'ticket_counter' && (rawValue === '' || rawValue == null)) continue;
      const value = rawValue == null ? '' : String(rawValue).trim();
      const oldValue = (await getGuildConfig(guildId, key))?.value ?? null;

      if (key === 'support_role') {
        const ids = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
        saveTicketGuildConfig(guildId, { supportRoleIds: ids });
      } else if (TICKET_KEY_MAP[key]) {
        saveTicketGuildConfig(guildId, { [TICKET_KEY_MAP[key]]: value });
      } else if (key === 'ticket_counter') {
        saveTicketGuildConfig(guildId, { ticketCounter: Number(value) || 0 });
      }

      if (!value) {
        await deleteGuildConfig(guildId, key);
      } else {
        await setGuildConfig(guildId, key, value);
      }

      logAudit(req.session.user.id, guildId, 'update_setting', key, oldValue, value, req.ip, req.sessionID);
      logActivity(req.session.user.id, guildId, 'update_setting', key, `تعديل ${key}`, req.ip, req.sessionID);
      changed++;
    }

    const synced = await syncConfigToBot();

    res.json({ success: true, changed, synced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/sync', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const synced = await syncConfigToBot();
    res.json({
      success: synced,
      message: synced ? 'تمت المزامنة الفورية مع البوت.' : 'البوت غير متصل — ستُطبق الإعدادات تلقائياً خلال ثوانٍ.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });

    const oldValue = await getGuildConfig(guildId, key);
    setGuildConfig(guildId, key, value);

    if (key === 'support_role') {
      const ids = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
      saveTicketGuildConfig(guildId, { supportRoleIds: ids });
    } else if (TICKET_KEY_MAP[key]) {
      const jsonKey = TICKET_KEY_MAP[key];
      saveTicketGuildConfig(guildId, { [jsonKey]: value });
    }

    logAudit(req.session.user.id, guildId, 'update_setting', key, oldValue, value, req.ip, req.sessionID);
    logActivity(req.session.user.id, guildId, 'update_setting', key, `تعديل ${key}`, req.ip, req.sessionID);

    res.json({ success: true, key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/delete', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });

    const oldValue = await getGuildConfig(guildId, key);
    deleteGuildConfig(guildId, key);

    logAudit(req.session.user.id, guildId, 'delete_setting', key, oldValue, null, req.ip, req.sessionID);
    logActivity(req.session.user.id, guildId, 'delete_setting', key, `حذف ${key}`, req.ip, req.sessionID);

    res.json({ success: true, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:guildId/all', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const config = getAllGuildConfig(guildId);
  res.json({ config });
});

export default router;