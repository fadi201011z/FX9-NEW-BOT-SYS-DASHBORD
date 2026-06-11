import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';

const router = Router();

router.get('/', isAuthenticated, (req, res) => {
  res.render('home', {
    user: req.session.user,
    title: 'الصفحة الرئيسية',
  });
});

export default router;
