import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, canModify } from '../middleware/auth.js';
import { getGuildChannels } from '../auth/discord.js';
import Notification from '../models/Notification.js';
import config from '../config.js';
import axios from 'axios';

const router = Router();

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);
  if (!guild) return res.redirect('/guilds');

  const subscriptions = await Notification.find({ guildId }).lean();

  // Fetch actual channels from Discord API
  let guildChannels = [];
  try {
    const channels = await getGuildChannels(guildId, config.discord.botToken);
    guildChannels = channels.filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name }));
  } catch {}

  res.render('guild/notifications', {
    user: req.session.user,
    guild,
    guildChannels,
    subscriptions,
    title: 'الإشعارات',
    currentPage: 'notifications',
  });
});

// API: add subscription (local DB + bot sync)
router.post('/:guildId/add', isAuthenticated, hasGuildAccess, canModify, async (req, res) => {
  const { guildId } = req.params;
  const { platform, url, discordChannelId, customMessage } = req.body;

  if (!platform || !url || !discordChannelId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Save to local DB
    const doc = await Notification.create({
      guildId, platform, channelUrl: url,
      discordChannelId, customMessage: customMessage || '',
    });

    // Attempt bot sync (non-blocking)
    try {
      await axios.post(`${config.botApiUrl}/api/notifications/add`, {
        guildId, platform, url, discordChannelId, customMessage,
      }, { timeout: 5000 });
    } catch (e) {
      console.error('[Notif] Bot sync failed:', e.code || e.message);
    }

    res.json({ success: true, id: doc._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: remove subscription
router.delete('/:guildId/:id', isAuthenticated, hasGuildAccess, canModify, async (req, res) => {
  const { id } = req.params;

  try {
    await Notification.deleteOne({ _id: id });

    // Attempt bot sync
    try {
      await axios.delete(`${config.botApiUrl}/api/notifications/${id}`, { timeout: 5000 });
    } catch (e) {
      console.error('[Notif] Bot delete sync failed:', e.code || e.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
