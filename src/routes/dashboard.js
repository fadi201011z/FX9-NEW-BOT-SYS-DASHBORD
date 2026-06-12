import { Router } from 'express';
import { isAuthenticated, isOwnerOrAdmin } from '../middleware/auth.js';
import { getBotGuilds, getGuildInfo, getInviteUrl } from '../auth/discord.js';
import { getAlerts, getUnreadAlerts, getUserAdminGuilds } from '../database.js';
import config from '../config.js';
import { getTotalTicketCount } from '../services/dataReader.js';

const router = Router();

router.get('/', isAuthenticated, isOwnerOrAdmin, async (req, res) => {
  try {
    const userGuilds = req.session.user.guilds || [];
    const userId = req.session.user.id;

    let botGuilds = [];
    let botGuildIds = new Set();
    try {
      botGuilds = await getBotGuilds(config.discord.botToken) || [];
      botGuildIds = new Set(botGuilds.map(g => g.id));
    } catch {}

    // Get guild IDs where user has Admin records (for non-owner admins)
    let adminGuildIds = new Set();
    if (userId !== config.discord.ownerId) {
      const adminRecords = await getUserAdminGuilds(userId);
      adminGuildIds = new Set((adminRecords || []).map(a => a.guildId));
    }

    const guildsWithBot = userGuilds
      .filter(g => botGuildIds.has(g.id) || adminGuildIds.has(g.id))
      .map(g => ({ ...g, hasBot: botGuildIds.has(g.id) }));

    const totalGuilds = botGuilds.length || guildsWithBot.length;
    let totalMembers = 0;
    let botPing = null;
    try {
      const statsRes = await fetch(`${config.botApiUrl}/api/stats`);
      if (statsRes.ok) {
        const stats = await statsRes.json();
        totalMembers = stats.members;
        botPing = stats.ping;
      }
    } catch {}
    const alerts = await getUnreadAlerts(null);
    const totalTickets = await getTotalTicketCount();

    res.render('dashboard', {
      user: req.session.user,
      guilds: guildsWithBot,
      totalGuilds,
      totalMembers,
      botPing,
      totalTickets,
      inviteUrl: getInviteUrl(),
      alerts,
      title: 'لوحة التحكم',
      clientId: config.discord.clientId,
    });
  } catch (err) {
    console.error('[Dashboard Error]', err);
    res.status(500).render('error', { layout: false, message: 'فشل تحميل لوحة التحكم.', user: req.session.user });
  }
});

export default router;
