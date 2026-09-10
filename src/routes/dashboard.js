import { Router } from 'express';
import { isAuthenticated, requireRole } from '../middleware/auth.js';
import { getBotGuilds, getGuildInfo } from '../auth/discord.js';
import { getAlerts, getUnreadAlerts, getUserAdminGuilds } from '../database.js';
import config from '../config.js';
import { getTotalTicketCount } from '../services/dataReader.js';

const router = Router();

router.get('/', isAuthenticated, requireRole('manager'), async (req, res) => {
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

    // Enrich guilds with live member counts from bot API (single call)
    let guildMemberCounts = new Map();
    try {
      const listRes = await fetch(`${config.botApiUrl}/api/guilds`, {
        signal: AbortSignal.timeout(4000),
      });
      if (listRes.ok) {
        const list = await listRes.json();
        if (Array.isArray(list)) {
          guildMemberCounts = new Map(list.map(g => [g.id, Number(g.memberCount) || 0]));
        }
      }
    } catch {}

    const guildsWithBot = userGuilds
      .filter(g => {
        const perms = BigInt(g.permissions);
        const canManage = (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
        return canManage || adminGuildIds.has(g.id);
      })
      .map(g => ({
        ...g,
        hasBot: botGuildIds.has(g.id),
        members: guildMemberCounts.has(g.id) ? guildMemberCounts.get(g.id) : null,
      }));

    const totalGuilds = botGuilds.length || guildsWithBot.length;
    let totalMembers = 0;
    let botPing = null;
    try {
      const statsRes = await fetch(`${config.botApiUrl}/api/stats`, {
        signal: AbortSignal.timeout(4000),
      });
      if (statsRes.ok) {
        const stats = await statsRes.json();
        totalMembers = Number.isFinite(Number(stats.members)) ? Number(stats.members) : 0;
        botPing = Number.isFinite(Number(stats.ping)) ? Number(stats.ping) : null;
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
