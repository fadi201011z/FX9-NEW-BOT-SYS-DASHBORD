import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, canModify } from '../middleware/auth.js';
import { getGuildChannels } from '../auth/discord.js';
import Notification from '../models/Notification.js';
import config from '../config.js';
import axios from 'axios';

const router = Router();

async function resolveYouTubeChannelId(url) {
  const clean = url.trim().replace(/\/[?#].*$/, '').replace(/\/$/, '');
  const chMatch = clean.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (chMatch) return chMatch[1];
  let handle = null;
  const handleMatch = clean.match(/youtube\.com\/@([\w-]+)/i);
  if (handleMatch) handle = handleMatch[1];
  const userMatch = clean.match(/youtube\.com\/user\/([\w-]+)/i);
  if (!handle && userMatch) handle = userMatch[1];
  const cMatch = clean.match(/youtube\.com\/c\/([\w-]+)/i);
  if (!handle && cMatch) handle = cMatch[1];
  if (!handle) return null;
  for (const page of [`https://www.youtube.com/@${handle}`, `https://www.youtube.com/@${handle}/about`]) {
    try {
      const res = await fetch(page, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });
      const html = await res.text();
      const idMatch = html.match(/"channelId":"(UC[\w-]+)"/) || html.match(/"externalId":"(UC[\w-]+)"/);
      if (idMatch) return idMatch[1];
    } catch {}
  }
  return null;
}

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
    // Resolve channelId (especially for YouTube)
    let channelId = url;
    if (platform === 'youtube') channelId = await resolveYouTubeChannelId(url) || '';
    else if (platform === 'kick') {
      const m = url.match(/kick\.com\/([\w-]+)/i);
      channelId = m ? m[1] : url.trim().replace(/^@/, '');
    } else if (platform === 'twitter') {
      const m = url.match(/(?:twitter\.com|x\.com)\/(\w+)/i);
      channelId = m ? m[1] : url.trim().replace(/^@/, '');
    }

    // Save to local DB (with resolved channelId)
    const doc = await Notification.create({
      guildId, platform, channelUrl: url, channelId,
      discordChannelId, customMessage: customMessage || '',
    });

    // Attempt bot sync (non-blocking) — retry once if fails
    let syncOk = false;
    try {
      await axios.post(`${config.botApiUrl}/api/notifications/add`, {
        guildId, platform, url, discordChannelId, customMessage, channelId,
      }, { timeout: 5000 });
      syncOk = true;
    } catch (e) {
      console.error('[Notif] Bot sync failed (1st try):', e.code || e.message);
    }
    if (!syncOk) {
      try {
        await axios.post(`${config.botApiUrl}/api/notifications/add`, {
          guildId, platform, url, discordChannelId, customMessage, channelId,
        }, { timeout: 5000 });
      } catch (e) {
        console.error('[Notif] Bot sync failed (2nd try):', e.code || e.message);
      }
    }

    res.json({ success: true, id: doc._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: send announcement via bot
router.post('/:guildId/announce', isAuthenticated, hasGuildAccess, canModify, async (req, res) => {
  const { guildId } = req.params;
  const { channelId, title, message, mention, color, image, thumbnail, footer, type, timestamp } = req.body;

  if (!channelId || !title || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await axios.post(`${config.botApiUrl}/api/announce`, {
      guildId, channelId, title, message, mention, color, image, thumbnail, footer, type, timestamp: timestamp !== false,
    }, { timeout: 10000 });
    res.json({ success: true });
  } catch (err) {
    console.error('[Announce] Bot send failed:', err.code || err.message);
    res.status(500).json({ error: 'فشل إرسال الإعلان، تأكد من أن البوت متصل' });
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
