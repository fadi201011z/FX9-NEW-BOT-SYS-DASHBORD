import { Router } from 'express';
import { isAuthenticated, isOwnerOrDev } from '../middleware/auth.js';
import { getBotGuilds, getGuildInfo, getInviteUrl } from '../auth/discord.js';
import { getAlerts, getUnreadAlerts } from '../database.js';
import config from '../config.js';
import { getTotalTicketCount } from '../services/dataReader.js';

const router = Router();

router.get('/', isAuthenticated, isOwnerOrDev, async (req, res) => {
  try {
    const userGuilds = req.session.user.guilds || [];

    let botGuilds = [];
    let botGuildIds = new Set();
    try {
      botGuilds = await getBotGuilds(config.discord.botToken) || [];
      botGuildIds = new Set(botGuilds.map(g => g.id));
    } catch {}

    const guildsWithBot = userGuilds
      .filter(g => {
        const perms = BigInt(g.permissions);
        const canManage = (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
        return canManage || botGuildIds.has(g.id);
      })
      .map(g => {
        const perms = BigInt(g.permissions);
        return {
          ...g,
          hasBot: botGuildIds.has(g.id),
          canManage: (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n,
        };
      });

    let totalMembers = 0;
    try {
      const results = await Promise.allSettled(botGuilds.map(g => getGuildInfo(g.id, config.discord.botToken)));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          totalMembers += r.value.approximate_member_count || r.value.member_count || 0;
        }
      }
    } catch {}
    const totalGuilds = botGuilds.length || guildsWithBot.length;
    const alerts = getUnreadAlerts(null);
    const totalTickets = getTotalTicketCount();

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
