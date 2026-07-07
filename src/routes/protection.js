import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { logActivity, getGuildConfig, setGuildConfig, deleteGuildConfig, getAllGuildConfig } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildChannels } from '../auth/discord.js';
import config from '../config.js';

const router = Router();

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);

  async function getCfg(key, def) {
    const val = await getGuildConfig(guildId, key);
    return val ? val.value : def;
  }

  const protection = {
    antiSpamEnabled: await getCfg('anti_spam', 'true'),
    antiLinkEnabled: await getCfg('anti_link', 'true'),
    antiMentionEnabled: await getCfg('anti_mention', 'true'),
    antiNukeEnabled: await getCfg('anti_nuke', 'true'),
    antiRaidEnabled: await getCfg('anti_raid', 'true'),
    spamLimit: await getCfg('spam_limit', '5'),
    spamWindow: await getCfg('spam_window', '5000'),
    spamPunishment: await getCfg('spam_punishment', 'timeout'),
    nukeChannelLimit: await getCfg('nuke_channel_limit', '3'),
    nukeBanLimit: await getCfg('nuke_ban_limit', '5'),
    nukeWindow: await getCfg('nuke_window', '10000'),
    raidLimit: await getCfg('raid_limit', '10'),
    raidWindow: await getCfg('raid_window', '10000'),
  };

  // Fetch restricted channels
  let restrictedChannels = [];
  const raw = await getCfg('restricted_channels', '[]');
  try { restrictedChannels = JSON.parse(raw); } catch {}

  // Fetch guild channels for the dropdown
  let guildChannels = [];
  try {
    guildChannels = await getGuildChannels(guildId, config.discord.botToken);
    guildChannels = guildChannels.filter(c => c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name }));
  } catch {}

  res.render('guild/protection', {
    user: req.session.user,
    guild,
    protection,
    restrictedChannels,
    guildChannels,
    title: 'إعدادات الحماية',
  });
});

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const updates = req.body;

    for (const [key, value] of Object.entries(updates)) {
      setGuildConfig(guildId, key, String(value));
    }

    logActivity(req.session.user.id, guildId, 'update_protection', null, 'تحديث إعدادات الحماية', req.ip, req.sessionID);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/restricted-channel/add', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { channelId, channelName } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId مطلوب' });

    const raw = await getGuildConfig(guildId, 'restricted_channels');
    let channels = [];
    try { channels = JSON.parse(raw?.value || '[]'); } catch {}

    if (channels.find(c => c.id === channelId)) {
      return res.json({ success: true, message: 'الروم مضاف مسبقاً' });
    }

    channels.push({ id: channelId, name: channelName || channelId });
    await setGuildConfig(guildId, 'restricted_channels', JSON.stringify(channels));

    logActivity(req.session.user.id, guildId, 'add_restricted_channel', channelId, `إضافة روم محضور ${channelName}`, req.ip, req.sessionID);

    // Notify bot to send setup message (non-blocking)
    try {
      const botRes = await fetch(`${config.botApiUrl}/api/restricted-channel-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId, channelId }),
        signal: AbortSignal.timeout(5000),
      });
      if (botRes.ok) {
        return res.json({ success: true, message: 'تمت إضافة الروم المحضور وإرسال رسالة الشرح.' });
      }
    } catch {}

    res.json({ success: true, message: 'تمت إضافة الروم المحضور.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/restricted-channel/remove', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId مطلوب' });

    const raw = await getGuildConfig(guildId, 'restricted_channels');
    let channels = [];
    try { channels = JSON.parse(raw?.value || '[]'); } catch {}

    const filtered = channels.filter(c => c.id !== channelId);
    await setGuildConfig(guildId, 'restricted_channels', JSON.stringify(filtered));

    logActivity(req.session.user.id, guildId, 'remove_restricted_channel', channelId, 'إزالة روم محضور', req.ip, req.sessionID);
    res.json({ success: true, message: 'تمت إزالة الروم المحضور.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
