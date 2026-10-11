import { Router } from 'express';
import { isAuthenticated, refreshSessionGuilds } from '../middleware/auth.js';
import { manageableGuilds, botGuildIds, compareManaged } from '../services/guildRail.js';
import { roleTokenFromLevel, ROLE_LABELS } from '../services/capabilities.js';

const router = Router();

router.get('/', isAuthenticated, async (req, res) => {
  // حدّث قائمة السيرفرات من Discord ليعكس أي سيرفر جديد أُضيف له البوت
  await refreshSessionGuilds(req);

  // نفس الفلتر الذي يستخدمه السايد بار: إدارة ديسكورد (0x8/0x20) أو رتبة
  // مُعيّنة من قسم المدراء. قبل ذلك كان هذا السطر يقرأ بتّات ديسكورد وحدها، فمن
  // أُعطي رتبة كان يرى السيرفر في /guilds ولا يراه هنا ولا في السايد بار.
  const mine = await manageableGuilds(req.session.user);

  // حالة البوت من نفس المصدر المخزَّن مؤقتاً الذي يقرأه السايد بار، فلا يمكن
  // أن تختلف الصفحتان على "هل البوت داخل السيرفر". null تعني أن البوت لم يُجب،
  // فتُقرأ "نعم" ولا يُقفل كل شيء بسبب تعطّل مؤقت (نفس منطق السايد بار).
  const botIds = await botGuildIds();
  const managedGuilds = mine.map(g => ({
    ...g,
    hasBot: botIds === null ? true : botIds.has(String(g.id)),
    myRoleLabel: ROLE_LABELS[roleTokenFromLevel(g.myLevel)] || 'إدارة',
  }));

  // الترتيب: السيرفر الذي فيه البوت وصاحب أعلى صلاحية أولاً، ثم الباقي.
  // نفس المقارنة المستخدمة في السايد بار (compareManaged) فلا تختلف القائمتان.
  managedGuilds.sort(compareManaged);

  res.render('home', {
    user: req.session.user,
    managedGuilds,
    title: 'الصفحة الرئيسية',
  });
});

export default router;
