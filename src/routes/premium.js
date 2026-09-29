import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { resolveGuild } from '../services/guildResolver.js';
import { getGuildConfig, setGuildConfig, logActivity } from '../database.js';

const router = Router();

// ════════════════════════════════════════════════════════════════════
//  ⚜️ نظام البريميوم — صفحة اشتراك مستقلة لكل سيرفر
//  خطتان: Standard + Ultimate (يُضبط السعر من هنا بسهولة)
// ════════════════════════════════════════════════════════════════════

// ── أكواد التفعيل السرية (لا تظهر في الصفحة أبداً) ──────────────────
// الكود الأول يُفعّل خطة Standard، والثاني يُفعّل خطة Ultimate
const ACTIVATION_CODES = {
  'FX9-STD-4829-KDMN': 'standard',
  'FX9-ULT-7153-QXWT': 'ultimate',
};

// أسعار الخطط — عدّل الأرقام هنا لتصبح العملة والسعر الذي تريده
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

// ─── محوّل اسم الخطة لعرض عربي للواجهة ──────────────────────────────
function planLabel(planId) {
  if (planId === 'ultimate') return 'Ultimate';
  if (planId === 'standard') return 'Standard';
  return planId || '';
}

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const guild = await resolveGuild(req.session.user.guilds, guildId);
    if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

    // ── الخطة المفعلة حالياً لهذا السيرفر ──
    let activePlanId = null;
    try {
      const cfg = await getGuildConfig(guildId, 'premium_plan');
      activePlanId = cfg?.value || null;
    } catch {}

    res.render('guild/premium', {
      user: req.session.user,
      guild,
      plans: PLANS,
      activePlanId,
      activePlanLabel: planLabel(activePlanId),
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

    // ── حفظ الخطة المفعلة في قاعدة البيانات ──
    await setGuildConfig(guildId, 'premium_plan', planId);

    // ── تسجيل النشاط ──
    try {
      await logActivity(req.session.user.id, guildId, 'activate_premium', planId, `تفعيل خطة ${planLabel(planId)} بالكود السري`, req.ip, req.sessionID);
    } catch {}

    return res.json({
      success: true,
      planId,
      planName: planLabel(planId),
      message: `✅ تم تفعيل خطة ${planLabel(planId)} بنجاح لسيرفرك!`,
    });
  } catch (err) {
    console.error('[Premium Activate Error]', err);
    return res.status(500).json({ success: false, error: 'حدث خطأ أثناء التفعيل.' });
  }
});

export default router;