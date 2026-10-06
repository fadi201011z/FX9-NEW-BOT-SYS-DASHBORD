import { Router } from 'express';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
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
import { botFetch, botPost } from '../services/botApi.js';

const router = Router();

router.get('/commands/stats', async (req, res) => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const botRes = await botFetch(`${config.botApiUrl}/api/commands/stats`, { signal: ctrl.signal });
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

// ─── Shared-secret self-report ─────────────────────────────────────────────
// A 401 from the bot is ambiguous on its own: the dashboard might have no
// API_SECRET at all (so botFetch sends no header), or it might hold a stale
// value from before a rotation. Those need opposite fixes — "add the variable"
// versus "make the two values identical" — so the page reports which one it is.
//
// The secret is never returned. `length` and an HMAC prefix are enough to spot
// the two failure modes that actually occur: a variable that never saved, and a
// value that picked up a stray space or newline on paste. The fingerprint is
// suppressed for short values, where it would help an attacker confirm a guess
// rather than requiring the full 384-bit secret to match.
const secretState = (() => {
  const s = config.apiSecret || '';
  return {
    configured: s.length > 0,
    length: s.length,
    hint: s.length >= 32
      ? crypto.createHmac('sha256', 'krs-secret-fingerprint-v1').update(s).digest('hex').slice(0, 8)
      : null,
  };
})();

router.get('/status', async (req, res) => {
  const start = Date.now();
  let guildCount = 0, members = null, ping = null, botOnline = false;

  // Why the bot looks offline is the single most useful thing this endpoint
  // can report, and a bare `false` hides every plausible cause. Each value
  // below maps to exactly one fix:
  //   404 → the bot is running an older build, or `ready` never fired
  //   401 → API_SECRET differs between dashboard and bot
  //   503 → API_SECRET is not set on the bot at all
  //   timeout / network → wrong BOT_API_URL, or the bot is still booting
  //   200 → the bot answered, so `online` must be true
  // The configured URL is deliberately not included: this route is public.
  let botApiHttp = null, botApiError = null;

  try {
    const botRes = await botFetch(`${config.botApiUrl}/api/stats`, {
      signal: AbortSignal.timeout(4000),
    }).catch((e) => {
      botApiError = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'network';
      return null;
    });

    if (botRes) {
      botApiHttp = botRes.status;
      if (botRes.ok) {
        const botData = await botRes.json();
        guildCount = botData.guilds ?? guildCount;
        members = botData.members ?? null;
        ping = botData.ping ?? null;
        botOnline = true;
        botApiError = null;
      } else {
        botApiError = `HTTP ${botRes.status}`;
      }
    }
  } catch (e) {
    botApiError = 'network';
  }

  if (!botOnline) {
    try {
      const botGuilds = await getBotGuilds(config.discord.botToken);
      guildCount = (botGuilds || []).length;
    } catch {}
  }

  res.json({
    status: botOnline ? 'online' : 'offline',
    botOnline,
    // Shape kept flat so the landing page can read it without a null check.
    botApiHttp,
    botApiError,
    // Which side of the mismatch is actually configured? A 401 means the bot
    // has its secret, so the dashboard is the side that is missing or stale —
    // but "missing" and "wrong value" need different fixes, and this route is
    // public so it cannot report the value itself.
    secretConfigured: secretState.configured,
    secretLength: secretState.length,
    secretHint: secretState.hint,
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform,
    // Whether Mongo is actually connected. The public status page reports it as
    // a component in its own right: every dashboard system that reads or writes
    // is only as available as this flag, and "the bot is up but nothing saves"
    // is otherwise indistinguishable from a healthy deploy. A boolean leaks
    // nothing the /tickets/stats endpoint above does not already answer.
    dbOnline: mongoose.connection.readyState === 1,
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
    const r = await botFetch(`${config.botApiUrl}/api/stats`, { signal: AbortSignal.timeout(4000) });
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
    name: 'Kratos System',
    version: '5.0.0',
    description: 'Kratos System — System + Tickets',
    dashboard: 'Kratos Dashboard v1.0.0',
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
