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

// ── Maintenance mode start / stop / save ──────────────────────────────
async function getOrCreateMaintenance() {
  let doc = await Maintenance.findOne();
  if (!doc) doc = new Maintenance();
  return doc;
}

router.get('/maintenance/start', isAuthenticated, isOwner, async (req, res) => {
  try {
    const doc = await getOrCreateMaintenance();
    doc.enabled = true;
    doc.updatedAt = Date.now();
    doc.updatedBy = req.session.user.id || '';
    await doc.save();
    res.redirect('/dev');
  } catch (err) {
    res.redirect('/dev?error=' + encodeURIComponent(err.message));
  }
});

router.get('/maintenance/stop', isAuthenticated, isOwner, async (req, res) => {
  try {
    const doc = await getOrCreateMaintenance();
    doc.enabled = false;
    doc.endTime = null;
    doc.updatedAt = Date.now();
    doc.updatedBy = req.session.user.id || '';
    await doc.save();
    res.redirect('/dev');
  } catch (err) {
    res.redirect('/dev?error=' + encodeURIComponent(err.message));
  }
});

router.post('/maintenance/save', isAuthenticated, isOwner, async (req, res) => {
  try {
    const minutes = parseInt(req.body.minutes || '0') || 0;
    const message = req.body.message || '';
    const doc = await getOrCreateMaintenance();
    doc.endTime = minutes > 0 ? Date.now() + minutes * 60 * 1000 : null;
    if (message.trim()) doc.message = message.trim();
    doc.updatedAt = Date.now();
    doc.updatedBy = req.session.user.id || '';
    await doc.save();
    res.redirect('/dev');
  } catch (err) {
    res.redirect('/dev?error=' + encodeURIComponent(err.message));
  }
});

export default router;
