import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { resolveGuild } from '../services/guildResolver.js';

const router = Router();

// ════════════════════════════════════════════════════════════════════
//  ⚜️ نظام البريميوم — صفحة اشتراك مستقلة لكل سيرفر
//  خطتان: Standard + Ultimate (يُضبط السعر من هنا بسهولة)
// ════════════════════════════════════════════════════════════════════

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

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const guild = await resolveGuild(req.session.user.guilds, guildId);
    if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

    res.render('guild/premium', {
      user: req.session.user,
      guild,
      plans: PLANS,
      title: 'نظام البريميوم',
    });
  } catch (err) {
    console.error('[Premium Error]', err);
    res.status(500).render('error', { layout: false, message: 'حدث خطأ في تحميل صفحة البريميوم.', user: req.session.user });
  }
});

export default router;