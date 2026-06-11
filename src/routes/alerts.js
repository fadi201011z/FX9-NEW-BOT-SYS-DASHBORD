import { Router } from 'express';
import { isAuthenticated, isOwner } from '../middleware/auth.js';
import { getAlerts, createAlert, markAlertRead, getUnreadAlerts } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';

const router = Router();

router.get('/', isAuthenticated, async (req, res) => {
  const unread = getUnreadAlerts(null);
  const allAlerts = getAlerts(null, 50);
  res.json({ unread, all: allAlerts });
});

router.post('/read', isAuthenticated, sanitizeInput, async (req, res) => {
  const { alertId } = req.body;
  if (!alertId) return res.status(400).json({ error: 'Alert ID required' });
  markAlertRead(parseInt(alertId));
  res.json({ success: true });
});

router.post('/create', isAuthenticated, sanitizeInput, async (req, res) => {
  try {
    const { guildId, type, severity, title, message } = req.body;
    createAlert(guildId || null, type || 'info', severity || 'info', title || 'تنبيه', message || '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
