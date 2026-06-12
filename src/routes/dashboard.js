import { Router } from 'express';
import { isAuthenticated, isOwner } from '../middleware/auth.js';
import { getBotGuilds, getGuildInfo, getInviteUrl } from '../auth/discord.js';
import { getAlerts, getUnreadAlerts } from '../database.js';
import config from '../config.js';
import { getTotalTicketCount } from '../services/dataReader.js';

const router = Router();

router.get('/', isAuthenticated, isOwner, async (req, res) => {
  try {
    const userGuilds = req.session.user.guilds || [];

    let botGuilds = [];
    let botGuildIds = new Set();
    try {
      botGuilds = await getBotGuilds(config.discord.botToken) || [];
      botGuildIds = new Set(botGuilds.map(g => g.id));
    } catch {}

    const guildsWithBot = userGuilds
      .filter(g => botGuildIds.has(g.id))
      .map(g => ({ ...g, hasBot: true }));

    const totalGuilds = botGuilds.length || guildsWithBot.length;
    const totalMembers = 0;
    const alerts = await getUnreadAlerts(null);
    const totalTickets = await getTotalTicketCount();

    res.render('dashboard', {
      user: req.session.user,
      guilds: guildsWithBot,
      totalGuilds,
      totalMembers,
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
