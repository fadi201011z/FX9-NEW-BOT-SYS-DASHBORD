import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { getActivity, getAuditLogs, getServerLogs, getServerLogStats, getGuildConfig } from '../database.js';
import { syncServerLogs } from '../services/serverLogSync.js';
import config from '../config.js';
import { resolveGuild } from '../services/guildResolver.js';

const router = Router();

const modOnly = requireRole('moderator');

// نافذة العرض = مدة الاحتفاظ نفسها، فتتطابق الأرقام المعروضة مع ما هو محفوظ فعلاً.
const windowStart = () => Date.now() - Math.max(1, config.logRetentionHours) * 3600 * 1000;

/**
 * يسحب أحداث البوت ثم يحدد قنوات السجلات المضبوطة. القنوات تُقرأ من البوت
 * (المصدر الموثوق) وإن تعذّر ذلك نرجع إلى قاعدة بيانات اللوحة.
 */
async function pullFromBot(guildId) {
  const sync = await syncServerLogs(guildId);
  let channels = sync.channels;
  if (!channels) {
    const [server, mod, bot] = await Promise.all([
      getGuildConfig(guildId, 'log_channel'),
      getGuildConfig(guildId, 'modlog_channel'),
      getGuildConfig(guildId, 'botlog_channel'),
    ]);
    channels = { server: Boolean(server), mod: Boolean(mod), bot: Boolean(bot) };
  }
  return { sync, channels };
}

/** يشرح — داخل الصفحة — سبب خلو السجل بدل ترك المستخدم يخمّن. */
function buildDiagnostic(sync, channels) {
  if (!sync.reachable) {
    return {
      kind: 'warn',
      title: 'تعذّر الوصول إلى البوت',
      hint: 'تأكد من ضبط BOT_API_URL و API_SECRET على اللوحة بنفس القيم الموجودة على البوت، فبدونهما لا يمكن قراءة سجلات السيرفر.',
    };
  }
  if (!sync.ok) {
    return {
      kind: 'warn',
      title: 'البوت يحتاج تحديثاً',
      hint: 'نسخة البوت الحالية لا ترسل السجلات إلى اللوحة. انشر آخر إصدار من البوت (يوفّر نقطة /api/dashboard-log) ثم أعد المحاولة.',
    };
  }
  if (channels && !channels.server && !channels.mod && !channels.bot) {
    return {
      kind: 'info',
      title: 'لا توجد قنوات سجلات مضبوطة في البوت',
      hint: 'البوت متصل لكنه لا يعرف أين يرسل الأحداث. اضبط قنوات السجلات من داخل ديسكورد بأمر البوت (/setup-logs للسجلات العامة و /setup-modlogs لسجلات الإشراف)، ثم ستظهر الأحداث هنا.',
    };
  }
  return {
    kind: 'info',
    title: 'البوت متصل — بانتظار أول حدث',
    hint: 'قنوات السجلات مضبوطة. سيظهر هنا أي حدث جديد في ديسكورد (رسالة، عضو، رتبة، صوت، إشراف) خلال لحظات من وقوعه.',
  };
}

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

// نقطة تحديث حيّة: نسحب من البوت أولاً ثم نعيد أحدث السجلات + الإحصاءات.
router.get('/:guildId/live', isAuthenticated, hasGuildAccess, modOnly, async (req, res) => {
  const { guildId } = req.params;
  await pullFromBot(guildId);
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

  // اسحب أحداث البوت قبل القراءة، حتى يظهر السجل فوراً دون انتظار الدفع الفوري.
  const { sync, channels } = await pullFromBot(guildId);

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
    diagnostic: serverLogs.length ? null : buildDiagnostic(sync, channels),
    title: 'السجلات',
  });
});

export default router;
