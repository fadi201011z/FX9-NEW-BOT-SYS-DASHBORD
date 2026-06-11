import { Router } from 'express';
import { isAuthenticated, hasGuildAccess } from '../middleware/auth.js';
import { logActivity, getGuildConfig, setGuildConfig } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';

const router = Router();

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);

  const protection = {
    antiSpamEnabled: getGuildConfig(guildId, 'anti_spam') || 'true',
    antiLinkEnabled: getGuildConfig(guildId, 'anti_link') || 'true',
    antiMentionEnabled: getGuildConfig(guildId, 'anti_mention') || 'true',
    antiNukeEnabled: getGuildConfig(guildId, 'anti_nuke') || 'true',
    antiRaidEnabled: getGuildConfig(guildId, 'anti_raid') || 'true',
    spamLimit: getGuildConfig(guildId, 'spam_limit') || '5',
    spamWindow: getGuildConfig(guildId, 'spam_window') || '5000',
    spamPunishment: getGuildConfig(guildId, 'spam_punishment') || 'timeout',
    nukeChannelLimit: getGuildConfig(guildId, 'nuke_channel_limit') || '3',
    nukeBanLimit: getGuildConfig(guildId, 'nuke_ban_limit') || '5',
    nukeWindow: getGuildConfig(guildId, 'nuke_window') || '10000',
    raidLimit: getGuildConfig(guildId, 'raid_limit') || '10',
    raidWindow: getGuildConfig(guildId, 'raid_window') || '10000',
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
