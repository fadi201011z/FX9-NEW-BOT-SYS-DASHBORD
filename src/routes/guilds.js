import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, isOwnerOrDev } from '../middleware/auth.js';
import { getBotGuilds, getSupportedGuilds, getGuildRoles, getGuildMember, getGuildInfo, getInviteUrl } from '../auth/discord.js';
import { getAllGuildConfig, getGuildAdmins, getAlerts, getActivity } from '../database.js';
import config from '../config.js';
import { getGuildTickets } from '../services/dataReader.js';

const router = Router();

router.get('/', isAuthenticated, isOwnerOrDev, async (req, res) => {
  const allGuilds = req.session.user.guilds || [];

  let botGuildIds = new Set();
  try {
    const botGuilds = await getBotGuilds(config.discord.botToken);
    botGuildIds = new Set(botGuilds.map(g => g.id));
  } catch {}

  const guilds = allGuilds
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

  res.render('guilds', {
    user: req.session.user,
    guilds,
    title: 'اختر السيرفر',
  });
});

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const guild = req.session.user.guilds?.find(g => g.id === guildId);
    if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

    const guildConfig = getAllGuildConfig(guildId);
    const admins = getGuildAdmins(guildId);
    const alerts = getAlerts(guildId, 10);
    const activity = getActivity(guildId, 10);

    let botGuildIds = new Set();
    let memberCount = 'N/A';
    try {
      const botGuilds = await getBotGuilds(config.discord.botToken);
      botGuildIds = new Set(botGuilds.map(g => g.id));
    } catch {}
    const botInGuild = botGuildIds.has(guildId);

    if (botInGuild) {
      try {
        const guildInfo = await getGuildInfo(guildId, config.discord.botToken);
        if (guildInfo) {
          memberCount = guildInfo.approximate_member_count || guildInfo.approximate_presence_count || guildInfo.member_count || 'N/A';
          guild.name = guildInfo.name;
          guild.icon = guildInfo.icon;
        }
      } catch {}
    }

    const tickets = getGuildTickets(guildId);

    res.render('guild/overview', {
      user: req.session.user,
      guild,
      guildConfig,
      admins,
      alerts,
      activity,
      botInGuild,
      memberCount,
      tickets,
      inviteUrl: getInviteUrl(),
      title: guild.name,
    });
  } catch (err) {
    console.error('[Guild Overview Error]', err);
    res.status(500).render('error', { layout: false, message: 'حدث خطأ في تحميل السيرفر.', user: req.session.user });
  }
});

export default router;
