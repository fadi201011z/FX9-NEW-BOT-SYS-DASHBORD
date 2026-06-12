import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, canModify } from '../middleware/auth.js';
import { getGuildConfig, setGuildConfig, getAllGuildConfig, deleteGuildConfig, logAudit, logActivity } from '../database.js';
import { getTicketGuildConfig, saveTicketGuildConfig } from '../services/dataReader.js';
import { sanitizeInput } from '../middleware/security.js';

const TICKET_KEY_MAP = {
  ticket_category: 'ticketCategoryId',
  admin_category: 'adminCategoryId',
  panel_channel: 'panelChannelId',
  log_channel_id: 'logChannelId',
};

const router = Router();

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);
  const config = await getAllGuildConfig(guildId);
  const ticketJson = await getTicketGuildConfig(guildId);
  if (ticketJson) {
    config.ticket_category = ticketJson.ticketCategoryId || (config.ticket_category || '');
    config.admin_category = ticketJson.adminCategoryId || (config.admin_category || '');
    config.panel_channel = ticketJson.panelChannelId || (config.panel_channel || '');
    config.log_channel_id = ticketJson.logChannelId || (config.log_channel_id || '');
    config.support_role = ticketJson.supportRoleIds.length ? ticketJson.supportRoleIds.join(', ') : (config.support_role || '');
    config.ticket_counter = ticketJson.ticketCounter || 0;
  }
  res.render('guild/settings', { user: req.session.user, guild, config, title: 'الإعدادات' });
});

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, canModify, sanitizeInput, async (req, res) => {
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

router.post('/:guildId/delete', isAuthenticated, hasGuildAccess, canModify, sanitizeInput, async (req, res) => {
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
