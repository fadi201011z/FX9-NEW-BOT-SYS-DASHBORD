import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { getActivity, getAuditLogs, getServerLogs, getServerLogStats } from '../database.js';
import config from '../config.js';
import { resolveGuild } from '../services/guildResolver.js';

const router = Router();

const modOnly = requireRole('moderator');

// نافذة العرض = مدة الاحتفاظ نفسها، فتتطابق الأرقام المعروضة مع ما هو محفوظ فعلاً.
const windowStart = () => Date.now() - Math.max(1, config.logRetentionHours) * 3600 * 1000;

router.get('/:guildId/activity', isAuthenticated, hasGuildAccess, modOnly, async (req, res) => {
  const { guildId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  const activity = await getActivity(guildId, limit);
  res.json({ activity });
});

router.get('/:guildId/audit', isAuthenticated, hasGuildAccess, modOnly, async (req, res) => {
  const { guildId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  const logs = await getAuditLogs(guildId, limit);
  res.json({ logs });
});

// سجلات سيرفر ديسكورد (من البوت) — ترقيم بالمؤشر `before` للتحميل التدريجي.
router.get('/:guildId/server', isAuthenticated, hasGuildAccess, modOnly, async (req, res) => {
  const { guildId } = req.params;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 60, 1), 120);
  const before = Number(req.query.before) || null;
  const rows = await getServerLogs(guildId, limit + 1, before);
  const hasMore = rows.length > limit;
  res.json({ logs: hasMore ? rows.slice(0, limit) : rows, hasMore });
});

// نقطة تحديث حيّة: أحدث السجلات + الإحصاءات، والواجهة تدمج الجديد حسب المعرّف.
router.get('/:guildId/live', isAuthenticated, hasGuildAccess, modOnly, async (req, res) => {
  const { guildId } = req.params;
  const [logs, stats] = await Promise.all([
    getServerLogs(guildId, 50),
    getServerLogStats(guildId, windowStart()),
  ]);
  res.json({ logs, stats, retentionHours: config.logRetentionHours });
});

router.get('/:guildId', isAuthenticated, hasGuildAccess, modOnly, async (req, res) => {
  const { guildId } = req.params;
  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

  const [serverLogs, stats, activity, auditLogs] = await Promise.all([
    getServerLogs(guildId, 60),
    getServerLogStats(guildId, windowStart()),
    getActivity(guildId, 60),
    getAuditLogs(guildId, 60),
  ]);

  res.render('guild/logs', {
    user: req.session.user,
    guild,
    serverLogs,
    stats,
    activity,
    auditLogs,
    retentionHours: config.logRetentionHours,
    title: 'السجلات',
  });
});

export default router;
