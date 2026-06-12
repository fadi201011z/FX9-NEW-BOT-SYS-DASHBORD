import { Router } from 'express';
import { isAuthenticated, hasGuildAccess } from '../middleware/auth.js';
import { logActivity, getGuildConfig, setGuildConfig } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';

const router = Router();

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
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

  res.render('guild/protection', {
    user: req.session.user,
    guild,
    protection,
    title: 'إعدادات الحماية',
  });
});

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, sanitizeInput, async (req, res) => {
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

export default router;
