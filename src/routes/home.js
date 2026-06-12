import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';

const router = Router();

router.get('/', isAuthenticated, (req, res) => {
  const guilds = req.session.user?.guilds || [];
  const managedGuilds = guilds.filter(g => (g.permissions & 0x8) === 0x8 || (g.permissions & 0x20) === 0x20);

  res.render('home', {
    user: req.session.user,
    managedGuilds,
    title: 'الصفحة الرئيسية',
  });
});

export default router;
