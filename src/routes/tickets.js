import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { logActivity, logAudit } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildTickets } from '../services/dataReader.js';
import { resolveGuild } from '../services/guildResolver.js';

const router = Router();

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('support'), async (req, res) => {
  const { guildId } = req.params;
  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });
  const tickets = await getGuildTickets(guildId);

  res.render('guild/tickets', {
    user: req.session.user,
    guild,
    tickets,
    ticketCount: tickets.total,
    title: 'إدارة التذاكر',
  });
});

router.post('/:guildId/close', isAuthenticated, hasGuildAccess, requireRole('support'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { ticketId } = req.body;
    logActivity(req.session.user.id, guildId, 'close_ticket', ticketId, `إغلاق تذكرة ${ticketId}`, req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'close_ticket', 'ticket', null, ticketId, req.ip, req.sessionID);
    const tickets = await getGuildTickets(guildId);
    res.json({ success: true, message: 'تم إغلاق التذكرة.', tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/reopen', isAuthenticated, hasGuildAccess, requireRole('support'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { ticketId } = req.body;
    logActivity(req.session.user.id, guildId, 'reopen_ticket', ticketId, `إعادة فتح تذكرة ${ticketId}`, req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'reopen_ticket', 'ticket', null, ticketId, req.ip, req.sessionID);
    const tickets = await getGuildTickets(guildId);
    res.json({ success: true, message: 'تم إعادة فتح التذكرة.', tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:guildId/count', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const tickets = await getGuildTickets(guildId);
  res.json({ tickets });
});

export default router;
