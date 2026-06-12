import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, isOwner } from '../middleware/auth.js';
import { getBotGuilds, getGuildInfo, getInviteUrl } from '../auth/discord.js';
import { getAllGuildConfig, getGuildAdmins, getAlerts, getActivity } from '../database.js';
import config from '../config.js';
import { getGuildTickets } from '../services/dataReader.js';

let botGuildCache = { ids: null, lastFetch: 0 };
const CACHE_TTL = 60000;

async function getBotGuildIds() {
  if (botGuildCache.ids && Date.now() - botGuildCache.lastFetch < CACHE_TTL) return botGuildCache.ids;
  try {
    const guilds = await getBotGuilds(config.discord.botToken);
    botGuildCache = { ids: new Set((guilds || []).map(g => g.id)), lastFetch: Date.now() };
  } catch (e) {
    console.error('[getBotGuildIds Error]', e?.response?.status, e?.message);
  }
  return botGuildCache.ids;
}

const router = Router();

router.get('/', isAuthenticated, isOwner, async (req, res) => {
  const allGuilds = req.session.user.guilds || [];
  const botGuildIds = await getBotGuildIds() || new Set();

  const guilds = allGuilds
    .filter(g => {
      const perms = BigInt(g.permissions);
      const canManage = (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
      const hasBot = botGuildIds.has(g.id);
      return canManage || hasBot;
    })
    .map(g => ({ ...g, hasBot: botGuildIds.has(g.id) }));

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

    const botGuildIds = await getBotGuildIds();
    const botInGuild = botGuildIds ? botGuildIds.has(guildId) : false;
    let memberCount = 'N/A';

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
