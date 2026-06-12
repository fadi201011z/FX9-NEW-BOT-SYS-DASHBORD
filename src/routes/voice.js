import { Router } from 'express';
import { isAuthenticated, hasGuildAccess } from '../middleware/auth.js';
import { logActivity } from '../database.js';
import { getGuildVoiceChannels } from '../services/dataReader.js';
import VoiceChannel from '../models/VoiceChannel.js';
import config from '../config.js';

const router = Router();

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);
  const voiceChannels = await getGuildVoiceChannels(guildId);

  res.render('guild/voice', {
    user: req.session.user,
    guild,
    voiceChannels,
    title: 'القنوات الصوتية المؤقتة',
  });
});

router.post('/:guildId/delete', isAuthenticated, hasGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId مطلوب' });

    // Delete from Discord
    try {
      await fetch(`https://discord.com/api/channels/${channelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${config.discord.botToken}` },
      });
    } catch {}

    // Delete from MongoDB
    await VoiceChannel.deleteOne({ vcId: channelId });

    await logActivity(req.session.user.id, guildId, 'delete_voice', channelId, `حذف قناة صوتية ${channelId}`, req.ip, req.sessionID);

    const voiceChannels = await getGuildVoiceChannels(guildId);
    res.json({ success: true, message: 'تم حذف القناة الصوتية.', voiceChannels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
