import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, refreshSessionGuilds } from '../middleware/auth.js';
import { getBotGuilds, getGuildInfo } from '../auth/discord.js';
import { getAllGuildConfig, getGuildAdmins, getAlerts, getActivity, getUserAdminGuilds } from '../database.js';
import config from '../config.js';
import { getGuildTickets, getTicketGuildConfig, getGuildVoiceChannels } from '../services/dataReader.js';
import { botFetch, botPost } from '../services/botApi.js';
import Feature from '../models/Feature.js';
import Notification from '../models/Notification.js';
import CommandConfig from '../models/CommandConfig.js';
import Backup from '../models/Backup.js';
import GuildConfig from '../models/GuildConfig.js';
import Ticket from '../models/Ticket.js';

let botGuildCache = { ids: null, lastFetch: 0 };
const CACHE_TTL = 300000;

async function getBotGuildIds(force) {
  if (!force && botGuildCache.ids) {
    if (Date.now() - botGuildCache.lastFetch < CACHE_TTL) return botGuildCache.ids;
    if (botGuildCache.rateLimited && Date.now() - botGuildCache.lastFetch < 60000) return botGuildCache.ids;
  }
  try {
    const botRes = await botFetch(`${config.botApiUrl}/api/guilds`, {
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (botRes && botRes.ok) {
      const data = await botRes.json();
      const ids = Array.isArray(data)
        ? data.map(g => g.id)
        : (Array.isArray(data?.guilds) ? data.guilds.map(String) : null);
      if (ids) {
        botGuildCache = { ids: new Set(ids), lastFetch: Date.now() };
        return botGuildCache.ids;
      }
    }
  } catch {}
  try {
    const guilds = await getBotGuilds(config.discord.botToken);
    botGuildCache = { ids: new Set((guilds || []).map(g => g.id)), lastFetch: Date.now() };
  } catch (e) {
    if (e?.response?.status === 429) {
      botGuildCache.rateLimited = true;
    }
  }
  return botGuildCache.ids;
}

const router = Router();

// No role guard here on purpose. The filter below already answers "which
// servers can this person actually do anything in" -- Discord admin rights or
// an Admin record, per server. A global role check on top of that used to
// return 403 to a Discord administrator who had never been appointed, and to
// anyone with zero servers, who should see an empty list rather than a refusal.
router.get('/', isAuthenticated, async (req, res) => {
  // حدّث قائمة السيرفرات من Discord ليعكس أي سيرفر جديد أُضيف له البوت
  await refreshSessionGuilds(req);
  const allGuilds = req.session.user.guilds || [];
  // استعلام مباشر عن سيرفرات البوت (بلا كاش) ليعكس سيرفراً أُضيف للتو
  const botGuildIds = await getBotGuildIds(true) || new Set();
  const userId = req.session.user.id;

  let adminGuildIds = new Set();
  if (userId !== config.discord.ownerId) {
    const adminRecords = await getUserAdminGuilds(userId);
    adminGuildIds = new Set((adminRecords || []).map(a => a.guildId));
  }

  const guilds = allGuilds
    .filter(g => {
      const perms = BigInt(g.permissions);
      const canManage = (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
      const isAdmin = adminGuildIds.has(g.id);
      return canManage || isAdmin;
    })
    .map(g => ({ ...g, hasBot: botGuildIds.has(g.id) }));

  // ─── تخصيب خفيف لبطاقات السيرفرات (قراءة فقط — لا يغيّر أي مسار أو حفظ) ──
  // memberCount قادم من /api/guilds/full: طلب واحد للبوت لكل القائمة بدل طلب لكل
  // سيرفر على حدة. GuildConfig والتذاكر بقراءة مجمّعة ($in) فكلفة القاعدة ثابتة مهما
  // كان عدد السيرفرات. كل فشل يُبتلع: تعطّل البوت أو بطء القاعدة يجب أن يُضعف
  // المحتوى فقط، ولا يُسقط الصفحة.
  const ids = guilds.map(g => String(g.id));
  const [fullGuildsRes, configRows, openTickets] = await Promise.all([
    botFetch(`${config.botApiUrl}/api/guilds/full`, { signal: AbortSignal.timeout(3500) }).catch(() => null),
    ids.length ? GuildConfig.find({ guildId: { $in: ids } }).lean().catch(() => []) : Promise.resolve([]),
    ids.length ? Ticket.find({ guildId: { $in: ids }, status: 'open' }).select('guildId').lean().catch(() => []) : Promise.resolve([]),
  ]);

  const memberCounts = {};
  if (fullGuildsRes && fullGuildsRes.ok) {
    try {
      const data = await fullGuildsRes.json();
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.guilds) ? data.guilds : []);
      for (const row of arr) {
        if (row && row.id != null && Number.isFinite(Number(row.memberCount))) {
          memberCounts[String(row.id)] = Number(row.memberCount);
        }
      }
    } catch {}
  }

  const configsByGuild = {};
  for (const row of configRows) {
    if (!configsByGuild[row.guildId]) configsByGuild[row.guildId] = {};
    configsByGuild[row.guildId][row.key] = row.value;
  }

  const openTicketCounts = {};
  for (const t of openTickets) {
    openTicketCounts[t.guildId] = (openTicketCounts[t.guildId] || 0) + 1;
  }

  const premiumNow = Date.now();
  for (const g of guilds) {
    const cfg = configsByGuild[g.id] || {};
    const protectionOn = PROTECTION_KEYS.filter(k => cfg[k] !== 'false').length;
    g.pulse = {
      memberCount: Number.isFinite(memberCounts[g.id]) ? memberCounts[g.id] : null,
      premium: cfg.premium_plan && Number(cfg.premium_expires_at) > premiumNow ? { plan: cfg.premium_plan } : null,
      protectionOn,
      welcomeOn: !!cfg.welcome_channel,
      statsOn: !!(cfg.stats_total || cfg.stats_online || cfg.stats_bots),
      logsOn: !!(cfg.log_channel || cfg.modlog_channel || cfg.botlog_channel),
      openTickets: openTicketCounts[g.id] || 0,
    };
  }

  res.render('guilds', {
    user: req.session.user,
    guilds,
    title: 'سيرفراتك',
  });
});

const PROTECTION_KEYS = ['anti_spam', 'anti_link', 'anti_mention', 'anti_nuke', 'anti_raid'];

/**
 * The health rows of the status page: one entry per system, in the order the
 * server owner thinks about them. `state` is the feature flag behind the
 * system when the bot has one — an absent flag reads `on`, which is exactly
 * what the bot does with it — and `detail` is what this server actually holds,
 * because a green pill over an unconfigured system is a lie in a nicer font.
 */
function buildSystems({ guildId, guildConfig, admins, tickets, voiceRooms, notifCount, backupCount, disabledCmds, premium, features }) {
  const state = (key) => {
    if (!key) return 'on';
    const flag = features.find(f => f.key === key);
    return flag?.state === 'off' || flag?.state === 'maintenance' ? flag.state : 'on';
  };
  const has = (...keys) => keys.some(k => guildConfig[k]);
  const onCount = PROTECTION_KEYS.filter(k => guildConfig[k] !== 'false').length;

  return [
    { name: 'الترحيب', icon: 'fa-door-open', href: `/settings/${guildId}`, state: state('welcome'),
      detail: has('welcome_channel') ? 'قناة الترحيب مضبوطة' : 'لم تُضبط قناة الترحيب' },
    { name: 'الإحصائيات', icon: 'fa-signal', href: `/settings/${guildId}`, state: state('setup'),
      detail: has('stats_total', 'stats_online', 'stats_bots') ? 'قنوات الإحصائية تعمل' : 'لا توجد قنوات إحصائية' },
    { name: 'السجلات', icon: 'fa-clock-rotate-left', href: `/logs/${guildId}`, state: state('logging'),
      detail: has('log_channel', 'modlog_channel', 'botlog_channel') ? 'قنوات السجل مضبوطة' : 'لم تُضبط قنوات السجل' },
    { name: 'التذاكر', icon: 'fa-ticket', href: `/tickets/${guildId}`, state: state('tickets'),
      detail: `${tickets.open.length} مفتوحة من ${tickets.total}` },
    { name: 'الرومات المؤقتة', icon: 'fa-microphone', href: `/voice/${guildId}`, state: state('temp_voice'),
      detail: voiceRooms.length ? `${voiceRooms.length} روم مفتوح الآن` : 'لا رومات مفتوحة' },
    { name: 'الإشعارات', icon: 'fa-bell', href: `/notifications/${guildId}`, state: state('notifications'),
      detail: notifCount ? `${notifCount} اشتراك نشط` : 'لا اشتراكات' },
    { name: 'الحماية', icon: 'fa-shield-halved', href: `/protection/${guildId}`, state: state('protection'),
      detail: `${onCount}/5 أنظمة مفعّلة` },
    { name: 'الأوامر', icon: 'fa-terminal', href: `/commands/${guildId}`, state: 'on',
      detail: disabledCmds ? `${disabledCmds} أمر مغلق` : 'كل الأوامر مفعّلة' },
    { name: 'المدراء', icon: 'fa-users-gear', href: `/admins/${guildId}`, state: 'on',
      detail: admins.length ? `${admins.length} مدير ورتبة` : 'لا مدراء بعد' },
    { name: 'البريميوم', icon: 'fa-gem', href: `/premium/${guildId}`, state: 'on',
      detail: premium ? `باقة ${premium.plan} — ${premium.daysLeft} يوم متبقية` : 'غير مفعّل' },
    { name: 'النسخ الاحتياطي', icon: 'fa-database', href: `/backup/${guildId}`, state: 'on',
      detail: backupCount ? `${backupCount} نسخة محفوظة` : 'لا نسخ بعد' },
  ];
}

// ─── حالة السيرفر ─────────────────────────────────────────────────────────
// Read-only, and behind `hasGuildAccess` alone with no role guard: this is
// the page an appointed moderator opens to see whether the server is healthy,
// and hiding a server's health from somebody already allowed into it answers
// nothing. It writes nothing and mutates nothing, so there is nothing to gate.
router.get('/:guildId/status', isAuthenticated, hasGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const guild = req.session.user.guilds?.find(g => g.id === guildId);
    if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 120);

    const [guildConfig, admins, tickets, voiceRooms, notifCount, backupCount, disabledCmds] = await Promise.all([
      getAllGuildConfig(guildId),
      getGuildAdmins(guildId),
      getGuildTickets(guildId),
      getGuildVoiceChannels(guildId),
      Notification.countDocuments({ guildId }),
      Backup.countDocuments({ guildId }),
      CommandConfig.countDocuments({ guildId, enabled: false }),
    ]);

    let features = [];
    try { features = await Feature.find({}).lean(); } catch {}

    // The bot is the only keeper of the daily history. If it is asleep the
    // page still renders and says so — a status page that invents numbers
    // when its source is down is worse than no status page at all.
    let botReachable = false;
    let memberCount = null;
    let series = [];

    const [statsRes, infoRes] = await Promise.all([
      botFetch(`${config.botApiUrl}/api/guilds/${guildId}/stats?days=${days}`, { signal: AbortSignal.timeout(6000) }).catch(() => null),
      botFetch(`${config.botApiUrl}/api/guilds/${guildId}/info`, { signal: AbortSignal.timeout(6000) }).catch(() => null),
    ]);

    if (infoRes && infoRes.ok) {
      try {
        const info = await infoRes.json();
        if (info && Number.isFinite(Number(info.memberCount))) {
          memberCount = Number(info.memberCount);
          guild.name = info.name || guild.name;
          guild.icon = info.icon || guild.icon;
          botReachable = true;
        }
      } catch {}
    }

    if (statsRes && statsRes.ok) {
      try {
        const payload = await statsRes.json();
        series = Array.isArray(payload?.series) ? payload.series : [];
        if (memberCount === null && Number.isFinite(Number(payload?.current?.memberCount))) {
          memberCount = Number(payload.current.memberCount);
        }
        botReachable = true;
      } catch {}
    }

    // Recomputed here rather than trusted from the response: the KPIs, the
    // chart and the footnote all read this one object, so they cannot disagree.
    const totals = series.reduce((acc, d) => ({
      joins: acc.joins + (d.joins || 0),
      leaves: acc.leaves + (d.leaves || 0),
      onlinePeak: Math.max(acc.onlinePeak, d.onlinePeak || 0),
    }), { joins: 0, leaves: 0, onlinePeak: 0 });

    const today = series.length ? series[series.length - 1] : null;
    const hasHistory = series.some(d => (d.joins || 0) > 0 || (d.leaves || 0) > 0 || (d.onlinePeak || 0) > 0);

    let premium = null;
    const premiumExpires = Number(guildConfig.premium_expires_at) || 0;
    if (guildConfig.premium_plan && premiumExpires > Date.now()) {
      premium = {
        plan: guildConfig.premium_plan,
        expiresAt: premiumExpires,
        daysLeft: Math.max(1, Math.ceil((premiumExpires - Date.now()) / 86400000)),
      };
    }

    const protectionCount = PROTECTION_KEYS.filter(k => guildConfig[k] !== 'false').length;

    const systems = buildSystems({
      guildId, guildConfig, admins, tickets, voiceRooms,
      notifCount, backupCount, disabledCmds, premium, features,
    });

    res.render('guild/server-status', {
      user: req.session.user,
      guild,
      title: `حالة سيرفرك • ${guild.name}`,
      days,
      series,
      totals,
      today,
      hasHistory,
      botReachable,
      memberCount,
      tickets,
      protectionCount,
      premium,
      systems,
    });
  } catch (err) {
    console.error('[Server Status Error]', err);
    res.status(500).render('error', { layout: false, message: 'حدث خطأ في تحميل حالة السيرفر.', user: req.session.user });
  }
});

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const guild = req.session.user.guilds?.find(g => g.id === guildId);
    if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

    const guildConfig = await getAllGuildConfig(guildId);
    const ticketCfg = await getTicketGuildConfig(guildId);
    if (ticketCfg) {
      guildConfig.ticket_category = ticketCfg.ticketCategoryId || '';
      guildConfig.admin_category = ticketCfg.adminCategoryId || '';
      guildConfig.panel_channel = ticketCfg.panelChannelId || '';
      guildConfig.log_channel_id = ticketCfg.logChannelId || '';
      guildConfig.support_role_ids = (ticketCfg.supportRoleIds || []).join(', ');
    }
    const admins = await getGuildAdmins(guildId);
    const alerts = await getAlerts(guildId, 10);
    const activity = await getActivity(guildId, 10);

    const botGuildIds = await getBotGuildIds(true);
    const botInGuild = botGuildIds ? botGuildIds.has(guildId) : false;
    let memberCount = 'N/A';

    // عدّادات خلفية خفيفة: كلها countDocuments/flat — تُغذّي "صحة الأنظمة" بنفس
    // المصدر الذي تعتمده صفحة "حالة سيرفرك"، فلا يمكن للصفحتين أن تختلفا على رقم.
    const [tickets, voiceRooms, notifCount, backupCount, disabledCmds] = await Promise.all([
      getGuildTickets(guildId),
      getGuildVoiceChannels(guildId),
      Notification.countDocuments({ guildId }),
      Backup.countDocuments({ guildId }),
      CommandConfig.countDocuments({ guildId, enabled: false }),
    ]);

    // أسماء القنوات والرتب لعرضها بدل المعرّفات الخام في الإعدادات المهمة.
    // فشل أيّ من الطلبين يُبتلع — صفحة النظرة العامة تستحق أن تنجو من بوت نائم.
    let channelsMap = {};
    let rolesMap = {};
    if (botInGuild) {
      const [chRes, rolesRes] = await Promise.all([
        botFetch(`${config.botApiUrl}/api/guilds/${guildId}/channels`, { signal: AbortSignal.timeout(3500) }).catch(() => null),
        botFetch(`${config.botApiUrl}/api/guilds/${guildId}/roles`, { signal: AbortSignal.timeout(3500) }).catch(() => null),
      ]);
      try {
        if (chRes && chRes.ok) {
          for (const c of await chRes.json()) {
            if (c && c.id != null) channelsMap[String(c.id)] = c.name || String(c.id);
          }
        }
      } catch {}
      try {
        if (rolesRes && rolesRes.ok) {
          for (const r of await rolesRes.json()) {
            if (r && r.id != null) rolesMap[String(r.id)] = r.name || String(r.id);
          }
        }
      } catch {}
    }

    if (botInGuild) {
      try {
        const botRes = await botFetch(`${config.botApiUrl}/api/guilds/${guildId}/info`, {
          signal: AbortSignal.timeout(4000),
        }).catch(() => null);
        if (botRes && botRes.ok) {
          const info = await botRes.json();
          if (info && Number.isFinite(Number(info.memberCount))) {
            memberCount = Number(info.memberCount);
            guild.name = info.name || guild.name;
            guild.icon = info.icon || guild.icon;
          }
        }
      } catch {}
      if (memberCount === 'N/A') {
        try {
          const guildInfo = await getGuildInfo(guildId, config.discord.botToken);
          if (guildInfo) {
            memberCount = guildInfo.approximate_member_count || guildInfo.approximate_presence_count || guildInfo.member_count || 'N/A';
            guild.name = guildInfo.name;
            guild.icon = guildInfo.icon;
          }
        } catch {}
      }
    }

    let features = [];
    try { features = await Feature.find({}).lean(); } catch {}

    let premium = null;
    const premiumExpires = Number(guildConfig.premium_expires_at) || 0;
    if (guildConfig.premium_plan && premiumExpires > Date.now()) {
      premium = {
        plan: guildConfig.premium_plan,
        expiresAt: premiumExpires,
        daysLeft: Math.max(1, Math.ceil((premiumExpires - Date.now()) / 86400000)),
      };
    }

    const protectionCount = PROTECTION_KEYS.filter(k => guildConfig[k] !== 'false').length;
    const systems = buildSystems({
      guildId, guildConfig, admins, tickets, voiceRooms,
      notifCount, backupCount, disabledCmds, premium, features,
    });

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
      channelsMap,
      rolesMap,
      premium,
      protectionCount,
      systems,
      title: guild.name,
    });
  } catch (err) {
    console.error('[Guild Overview Error]', err);
    res.status(500).render('error', { layout: false, message: 'حدث خطأ في تحميل السيرفر.', user: req.session.user });
  }
});

export default router;
