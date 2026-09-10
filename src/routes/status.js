import { Router } from 'express';
import mongoose from 'mongoose';
import { isAuthenticated, hasGuildAccess, isOwner, clearBotGuildCache } from '../middleware/auth.js';
import { getGuildConfig, getActivity, getAlerts, getUserActivity, getAllGuildConfig, getGuildAdmins } from '../database.js';
import { getCommandStats } from '../services/syncService.js';
import { getBotGuilds } from '../auth/discord.js';
import config from '../config.js';
import Ticket from '../models/Ticket.js';
import Admin from '../models/Admin.js';
import TicketGuildConfig from '../models/TicketGuildConfig.js';
import VoiceChannel from '../models/VoiceChannel.js';
import GuildAdminRole from '../models/GuildAdminRole.js';
import CommandConfig from '../models/CommandConfig.js';
import AuditLog from '../models/AuditLog.js';
import Activity from '../models/Activity.js';
import Alert from '../models/Alert.js';
import Backup from '../models/Backup.js';
import GuildConfig from '../models/GuildConfig.js';
import Maintenance from '../models/Maintenance.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';

const router = Router();

router.get('/commands/stats', async (req, res) => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const botRes = await fetch(`${config.botApiUrl}/api/commands/stats`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (botRes.ok) {
      const data = await botRes.json();
      if (data && typeof data.total === 'number') return res.json(data);
    }
  } catch {}
  res.json(getCommandStats());
});

router.get('/tickets/stats', async (req, res) => {
  const total = await Ticket.countDocuments();
  const open = await Ticket.countDocuments({ status: 'open' });
  const closed = await Ticket.countDocuments({ status: 'closed' });
  res.json({ total, open, closed });
});

router.get('/status', async (req, res) => {
  const start = Date.now();
  let guildCount = 0, members = null, ping = null, botOnline = false;
  try {
    const botRes = await fetch(`${config.botApiUrl}/api/stats`, {
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (botRes && botRes.ok) {
      const botData = await botRes.json();
      guildCount = botData.guilds ?? guildCount;
      members = botData.members ?? null;
      ping = botData.ping ?? null;
      botOnline = true;
    }
  } catch {}
  if (!botOnline) {
    try {
      const botGuilds = await getBotGuilds(config.discord.botToken);
      guildCount = (botGuilds || []).length;
    } catch {}
  }
  res.json({
    status: botOnline ? 'online' : 'offline',
    botOnline,
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform,
    responseTime: Date.now() - start,
    guildCount,
    members,
    ping,
  });
});

router.get('/diagnostics', isAuthenticated, isOwner, async (req, res) => {
  const out = {
    generatedAt: Date.now(),
    botApi: { baseUrl: config.botApiUrl, online: false, stats: null, error: null },
    discord: { hasBotToken: Boolean(config.discord.botToken), ownerId: config.discord.ownerId },
    mongo: { connected: false, dbName: null, collections: {} },
  };

  try {
    const r = await fetch(`${config.botApiUrl}/api/stats`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      out.botApi.online = true;
      out.botApi.stats = await r.json();
    } else {
      out.botApi.error = `HTTP ${r.status}`;
    }
  } catch (e) {
    out.botApi.error = e.name === 'AbortError' ? 'timeout' : (e.message || 'fetch error');
  }

  try {
    out.mongo.connected = mongoose.connection.readyState === 1;
    if (out.mongo.connected) {
      out.mongo.dbName = mongoose.connection.db?.databaseName || null;
      const models = {
        tickets: Ticket, voice_channels: VoiceChannel, admins: Admin, activities: Activity,
        alerts: Alert, audit_logs: AuditLog, backups: Backup, users: User,
        notifications: Notification, guild_configs: GuildConfig, ticket_configs: TicketGuildConfig,
        command_configs: CommandConfig, admin_roles: GuildAdminRole, maintenances: Maintenance,
      };
      for (const [k, M] of Object.entries(models)) {
        out.mongo.collections[k] = await M.countDocuments().catch(() => 0);
      }
    }
  } catch (e) {
    out.mongo.error = e.message;
  }

  res.json(out);
});

router.get('/guild/:guildId/stats', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const config_data = await getAllGuildConfig(guildId);
  const activity = await getActivity(guildId, 500);
  const alerts = await getAlerts(guildId, 50);

  const actionCounts = {};
  for (const a of activity) {
    actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
  }

  const admins = await getGuildAdmins(guildId);

  res.json({
    guildId,
    configKeys: Object.keys(config_data).length,
    activityCount: activity.length,
    alertCount: alerts.length,
    adminCount: admins.length,
    actions: actionCounts,
  });
});

router.get('/user/activity', isAuthenticated, async (req, res) => {
  const activity = await getUserActivity(req.session.user.id, 50);
  res.json({ activity });
});

router.get('/bot/info', async (req, res) => {
  res.json({
    name: 'FX9 Merged Bot',
    version: '5.0.0',
    description: 'FX9 Merged Bot — System + Tickets',
    dashboard: 'FX9 Dashboard v1.0.0',
    owner: config.discord.ownerId,
    uptime: process.uptime(),
    nodeVersion: process.version,
  });
});

router.post('/tickets/cleanup', isAuthenticated, isOwner, async (req, res) => {
  try {
    const total = await Ticket.countDocuments({});
    if (total === 0) return res.json({ success: true, deleted: 0, message: 'لا توجد تذاكر' });
    if (total > 5) return res.status(400).json({ error: 'يوجد أكثر من 5 تذاكر حقيقية، لا يمكن التنظيف' });
    const result = await Ticket.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Webhook: Bot calls this when removed from a guild ────────────────────
router.post('/webhooks/guild-delete', async (req, res) => {
  try {
    const { guildId, secret } = req.body;
    if (!guildId || secret !== config.discord.botToken) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await Promise.all([
      Admin.deleteMany({ guildId }),
      GuildConfig.deleteMany({ guildId }),
      Ticket.deleteMany({ guildId }),
      TicketGuildConfig.deleteOne({ guildId }),
      VoiceChannel.deleteMany({ guildId }),
      GuildAdminRole.deleteMany({ guildId }),
      CommandConfig.deleteMany({ guildId }),
      AuditLog.deleteMany({ guildId }),
      Activity.deleteMany({ guildId }),
      Alert.deleteMany({ guildId }),
      Backup.deleteMany({ guildId }),
    ]);

    clearBotGuildCache();

    console.log(`[Webhook] Cleaned all data for guild ${guildId}`);
    res.json({ success: true, message: 'تم حذف بيانات السيرفر بالكامل.' });
  } catch (err) {
    console.error('[Webhook Guild Delete Error]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
