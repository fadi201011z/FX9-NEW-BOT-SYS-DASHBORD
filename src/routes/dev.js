import { Router } from 'express';
import { isAuthenticated, isOwner } from '../middleware/auth.js';
import { getAllGuildConfig, getGuildAdmins, getActivity, getAuditLogs } from '../database.js';
import { getBotGuilds } from '../auth/discord.js';
import Maintenance from '../models/Maintenance.js';
import config from '../config.js';

const router = Router();

router.get('/', isAuthenticated, isOwner, async (req, res) => {
  let botGuilds = [];
  try { botGuilds = await getBotGuilds(config.discord.botToken); } catch {}

  const guildsData = [];
  for (const g of botGuilds) {
    const cfg = await getAllGuildConfig(g.id);
    const admins = await getGuildAdmins(g.id);
    guildsData.push({
      id: g.id,
      name: g.name,
      icon: g.icon,
      configCount: Object.keys(cfg).length,
      adminCount: admins.length,
    });
  }

  let maintenance = await Maintenance.findOne().lean();
  if (!maintenance) maintenance = { enabled: false, endTime: null, message: '' };

  res.render('dev', {
    user: req.session.user,
    botGuilds: guildsData,
    ownerId: config.discord.ownerId,
    maintenance,
    title: 'لوحة المطور',
  });
});

router.get('/guild/:guildId', isAuthenticated, isOwner, async (req, res) => {
  const { guildId } = req.params;
  const config_data = await getAllGuildConfig(guildId);
  const admins = await getGuildAdmins(guildId);
  const activity = await getActivity(guildId, 200);
  const audit = await getAuditLogs(guildId, 200);

  res.json({
    config: config_data,
    admins,
    activityCount: activity.length,
    auditCount: audit.length,
  });
});

// ── Maintenance mode toggle ───────────────────────────────────────────
router.post('/maintenance/toggle', isAuthenticated, isOwner, async (req, res) => {
  const { enabled, endTime, message } = req.body;
  try {
    const doc = await Maintenance.findOne() || new Maintenance();
    doc.enabled = !!enabled;
    doc.endTime = endTime ? Number(endTime) : null;
    if (message) doc.message = message;
    doc.updatedAt = Date.now();
    doc.updatedBy = req.session.user?.id || '';
    await doc.save();
    res.json({ success: true, enabled: doc.enabled, endTime: doc.endTime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/maintenance/status', async (req, res) => {
  const doc = await Maintenance.findOne().lean();
  if (!doc) return res.json({ enabled: false });
  res.json({ enabled: doc.enabled, endTime: doc.endTime, message: doc.message });
});

export default router;
