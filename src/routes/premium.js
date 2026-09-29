import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { resolveGuild } from '../services/guildResolver.js';

const router = Router();

// ════════════════════════════════════════════════════════════════════
//  ⚜️ نظام البريميوم — صفحة مستقلة لكل سيرفر
//  الصفحة «فارغة» حالياً — يُضاف المحتوى لاحقاً حسب طلب المستخدم
// ════════════════════════════════════════════════════════════════════

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const guild = await resolveGuild(req.session.user.guilds, guildId);
    if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

    res.render('guild/premium', {
      user: req.session.user,
      guild,
      title: 'نظام البريميوم',
    });
  } catch (err) {
    console.error('[Premium Error]', err);
    res.status(500).render('error', { layout: false, message: 'حدث خطأ في تحميل صفحة البريميوم.', user: req.session.user });
  }
});

export default router;