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

  let maintenanceRaw = await Maintenance.findOne().lean();
  const maintenance = {
    enabled: maintenanceRaw?.enabled || false,
    endTime: maintenanceRaw?.endTime || null,
    message: maintenanceRaw?.message || '',
    updatedAt: maintenanceRaw?.updatedAt || 0,
    updatedBy: maintenanceRaw?.updatedBy || '',
  };

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
  try {
    // support both JSON and form submissions
    const enabled = req.body.enabled === 'true' || req.body.enabled === true;
    const minutes = parseInt(req.body.minutes || req.body.saveMinutes || '0') || 0;
    const endTime = minutes > 0 ? Date.now() + minutes * 60 * 1000 : null;
    const message = req.body.message || '';

    let doc = await Maintenance.findOne();
    if (!doc) doc = new Maintenance();
    doc.enabled = enabled;
    doc.endTime = endTime;
    if (message.trim()) doc.message = message.trim();
    doc.updatedAt = Date.now();
    doc.updatedBy = req.session.user.id || '';
    await doc.save();

    // if JSON request, respond with JSON
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, enabled: doc.enabled, endTime: doc.endTime, message: doc.message });
    }
    // otherwise redirect back to dev panel
    res.redirect('/dev');
  } catch (err) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect('/dev?error=' + encodeURIComponent(err.message));
  }
});

export default router;
