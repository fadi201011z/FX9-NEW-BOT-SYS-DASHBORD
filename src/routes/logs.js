import { Router } from 'express';
import { isAuthenticated, hasGuildAccess } from '../middleware/auth.js';
import { getActivity, getAuditLogs } from '../database.js';

const router = Router();

router.get('/:guildId/activity', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  const activity = getActivity(guildId, limit);
  res.json({ activity });
});

router.get('/:guildId/audit', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  const logs = getAuditLogs(guildId, limit);
  res.json({ logs });
});

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);
  const activity = getActivity(guildId, 100);
  const auditLogs = getAuditLogs(guildId, 100);

  res.render('guild/logs', {
    user: req.session.user,
    guild,
    activity,
    auditLogs,
    title: 'سجل النشاط',
  });
});

export default router;
