import { Router } from 'express';
import { isAuthenticated, refreshSessionGuilds } from '../middleware/auth.js';
import config from '../config.js';
import { botFetch, botPost } from '../services/botApi.js';

const router = Router();

router.get('/', isAuthenticated, async (req, res) => {
  // حدّث قائمة السيرفرات من Discord ليعكس أي سيرفر جديد أُضيف له البوت
  await refreshSessionGuilds(req);
  const guilds = req.session.user?.guilds || [];
  let managedGuilds = guilds.filter(g => (g.permissions & 0x8) === 0x8 || (g.permissions & 0x20) === 0x20);

  // إظهار السيرفرات التي يتواجد فيها البوت فقط
  try {
    const botRes = await botFetch(`${config.botApiUrl}/api/guilds`, { signal: AbortSignal.timeout(4000) });
    if (botRes.ok) {
      const data = await botRes.json();
      if (Array.isArray(data.guilds)) {
        const botGuildIds = new Set(data.guilds.map(String));
        managedGuilds = managedGuilds.filter(g => botGuildIds.has(String(g.id)));
      }
    }
  } catch {}

  res.render('home', {
    user: req.session.user,
    managedGuilds,
    title: 'الصفحة الرئيسية',
  });
});

export default router;