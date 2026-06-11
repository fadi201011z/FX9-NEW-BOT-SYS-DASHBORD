import { Router } from 'express';
import { isAuthenticated, hasGuildAccess } from '../middleware/auth.js';
import { getUserSettings, updateUserSettings } from '../database.js';

const router = Router();

router.get('/settings', isAuthenticated, async (req, res) => {
  const settings = getUserSettings(req.session.user.id);
  res.json({ settings });
});

router.post('/settings/update', isAuthenticated, async (req, res) => {
  const { settings } = req.body;
  if (!settings) return res.status(400).json({ error: 'Settings required' });
  updateUserSettings(req.session.user.id, settings);
  if (settings.theme) req.session.user.theme = settings.theme;
  res.json({ success: true });
});

export default router;
