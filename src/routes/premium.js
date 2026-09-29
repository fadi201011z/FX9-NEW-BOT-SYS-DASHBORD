import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole, clearPremiumStatusCache } from '../middleware/auth.js';
import { resolveGuild } from '../services/guildResolver.js';
import { getGuildConfig, setGuildConfig, deleteGuildConfig, logActivity } from '../database.js';

const router = Router();

// ════════════════════════════════════════════════════════════════════
//  ⚜️ نظام البريميوم — اشتراك / تفعيل بالكود السري
//  منطق الاحترافية:
//   - عند فتح الصفحة بلا اشتراك فعّال → تظهر النافذتان فوراً (خطط + كود)
//   - عند تفعيل اشتراك → تختفي النافذتان ولا تظهران حتى انتهاء المدة
// ════════════════════════════════════════════════════════════════════

// ── أكواد التفعيل السرية (لا تظهر في الصفحة أبداً) ──────────────────
const ACTIVATION_CODES = {
  'FX9-STD-4829-KDMN': 'standard',
  'FX9-ULT-7153-QXWT': 'ultimate',
};

// ── مدة الاشتراك عند التفعيل بالكود (بالأيام) ───────────────────────
const SUBSCRIPTION_DAYS = 30;

// ── أسعار الخطط ──────────────────────────────────────────────────────
const PLANS = [
  {
    id: 'standard',
    name: 'Standard',
    icon: 'fa-shield-halved',
    price: '$4.99',
    period: 'شهرياً',
    yearlyPrice: '$49.99',
    tagline: 'الأساس المتين لسيرفرك',
    popular: false,
    durationDays: SUBSCRIPTION_DAYS,
    features: [
      'لوحة تحكم كاملة',
      'أنظمة الحماية الأساسية',
      'رومات محضورة (5 رومات)',
      'قنوات ترحيب ومغادرة',
      'دعم فني أساسي',
    ],
  },
  {
    id: 'ultimate',
    name: 'Ultimate',
    icon: 'fa-crown',
    price: '$9.99',
    period: 'شهرياً',
    yearlyPrice: '$99.99',
    tagline: 'أقصى قوة وصلاحيات لسيرفرك',
    popular: true,
    durationDays: SUBSCRIPTION_DAYS,
    features: [
      'كل مزايا Standard',
      'جميع أنظمة الحماية المتقدمة',
      'رومات محضورة بدون حدود',
      'التذاكر والرومات الصوتية',
      'إشعارات وإعلانات ذكية',
      'أولوية الدعم الفني 24/7',
    ],
  },
];

// ─── محوّل اسم الخطة للعرض ───────────────────────────────────────────
function planLabel(planId) {
  if (planId === 'ultimate') return 'Ultimate';
  if (planId === 'standard') return 'Standard';
  return planId || '';
}

// ─── تنسيق أبجدية الأخبار بالعربية (يسار/يمين) ────────────────────────
function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// ─── حساب المدة المتبقية بالأيام والساعات ────────────────────────────
function remainingText(expiresAt) {
  const now = Date.now();
  const diff = expiresAt - now;
  if (diff <= 0) return 'انتهى الاشتراك';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days} يوم${days === 1 ? '' : 'اً'} و ${hours} ساعة`;
  if (hours >= 1) return `${hours} ساعة`;
  const mins = Math.max(1, Math.floor(diff / 60_000));
  return `${mins} دقيقة`;
}

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const guild = await resolveGuild(req.session.user.guilds, guildId);
    if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

    // ── حالة الاشتراك الحالية ──
    let activePlanId = null;
    let activatedAt = null;
    let expiresAt = null;
    try {
      const planCfg = await getGuildConfig(guildId, 'premium_plan');
      const startCfg = await getGuildConfig(guildId, 'premium_activated_at');
      const endCfg = await getGuildConfig(guildId, 'premium_expires_at');
      activePlanId = planCfg?.value || null;
      activatedAt = startCfg?.value ? Number(startCfg.value) : null;
      expiresAt = endCfg?.value ? Number(endCfg.value) : null;
    } catch {}

    // ── إذا انتهت المدة → حذف الاشتراك ليظهر السيرفر كأنه جديد ──
    if (activePlanId && expiresAt && expiresAt <= Date.now()) {
      try {
        await deleteGuildConfig(guildId, 'premium_plan');
        await deleteGuildConfig(guildId, 'premium_activated_at');
        await deleteGuildConfig(guildId, 'premium_expires_at');
      } catch {}
      activePlanId = null;
      activatedAt = null;
      expiresAt = null;
    }

    res.render('guild/premium', {
      user: req.session.user,
      guild,
      plans: PLANS,
      activePlanId,
      activePlanLabel: planLabel(activePlanId),
      remainingDays: SUBSCRIPTION_DAYS,
      activatedAt,
      expiresAt,
      activatedAtText: formatDate(activatedAt),
      expiresAtText: formatDate(expiresAt),
      remainingText: expiresAt ? remainingText(expiresAt) : '',
      title: 'نظام البريميوم',
    });
  } catch (err) {
    console.error('[Premium Error]', err);
    res.status(500).render('error', { layout: false, message: 'حدث خطأ في تحميل صفحة البريميوم.', user: req.session.user });
  }
});

// ─── ⚜️ تفعيل الخطة بالكود السري ─────────────────────────────────────
router.post('/:guildId/activate', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const code = String(req.body?.code || '').trim().toUpperCase();

    if (!code) {
      return res.status(400).json({ success: false, error: 'أدخل الكود السري أولاً.' });
    }

    const planId = ACTIVATION_CODES[code];
    if (!planId) {
      return res.status(400).json({ success: false, error: 'الكود السري غير صحيح.' });
    }

    const plan = PLANS.find(p => p.id === planId);
    const now = Date.now();
    const expires = now + (plan?.durationDays || SUBSCRIPTION_DAYS) * 86_400_000;

    await setGuildConfig(guildId, 'premium_plan', planId);
    await setGuildConfig(guildId, 'premium_activated_at', String(now));
    await setGuildConfig(guildId, 'premium_expires_at', String(expires));
    clearPremiumStatusCache(guildId);

    try {
      await logActivity(req.session.user.id, guildId, 'activate_premium', planId,
        `تفعيل خطة ${planLabel(planId)} بالكود السري لمدة ${plan?.durationDays || SUBSCRIPTION_DAYS} يوم`,
        req.ip, req.sessionID);
    } catch {}

    return res.json({
      success: true,
      planId,
      planName: planLabel(planId),
      expiresAt: expires,
      message: `✅ تم تفعيل خطة ${planLabel(planId)} لمدة ${plan?.durationDays || SUBSCRIPTION_DAYS} يوماً!`,
    });
  } catch (err) {
    console.error('[Premium Activate Error]', err);
    return res.status(500).json({ success: false, error: 'حدث خطأ أثناء التفعيل.' });
  }
});

// ─── ⚜️ إنهاء الاشتراك (يُظهر الصفحات من جديد) ────────────────────────
router.post('/:guildId/deactivate', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    await deleteGuildConfig(guildId, 'premium_plan');
    await deleteGuildConfig(guildId, 'premium_activated_at');
    await deleteGuildConfig(guildId, 'premium_expires_at');
    clearPremiumStatusCache(guildId);
    try {
      await logActivity(req.session.user.id, guildId, 'deactivate_premium', null, 'إنهاء/إلغاء اشتراك البريميوم', req.ip, req.sessionID);
    } catch {}
    return res.json({ success: true, message: 'تم إنهاء الاشتراك — أصبحت النافذتان ظاهرتين من جديد.' });
  } catch (err) {
    console.error('[Premium Deactivate Error]', err);
    return res.status(500).json({ success: false, error: 'حدث خطأ أثناء الإنهاء.' });
  }
});

export default router;