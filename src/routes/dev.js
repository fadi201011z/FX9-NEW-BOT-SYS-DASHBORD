import { Router } from 'express';
import { isAuthenticated, isOwner } from '../middleware/auth.js';
import { getAllGuildConfig, getGuildAdmins, getActivity, getAuditLogs } from '../database.js';
import { getBotGuilds } from '../auth/discord.js';
import Maintenance from '../models/Maintenance.js';
import config from '../config.js';
import axios from 'axios';

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

  let maintenanceDoc = await Maintenance.findOne();
  if (maintenanceDoc && maintenanceDoc.enabled && maintenanceDoc.endTime && Date.now() >= maintenanceDoc.endTime) {
    maintenanceDoc.enabled = false;
    maintenanceDoc.endTime = null;
    await maintenanceDoc.save();
  }
  const maintenanceRaw = maintenanceDoc ? maintenanceDoc.toObject() : null;
  const maintenance = {
    enabled: maintenanceRaw?.enabled || false,
    endTime: maintenanceRaw?.endTime || null,
    durationMinutes: maintenanceRaw?.durationMinutes || 0,
    message: maintenanceRaw?.message || '',
    channelId: maintenanceRaw?.channelId || '',
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

async function syncMaintenanceToBot(action, channelId) {
  try {
    const body = {};
    if (action) body.action = action;
    if (channelId) body.channelId = channelId;
    await axios.post(`${config.botApiUrl}/api/maintenance/sync`, body, { timeout: 3000 });
  } catch {}
}

router.get('/maintenance/status', async (req, res) => {
  try {
    const doc = await Maintenance.findOne();
    if (!doc) return res.json({ enabled: false });
    if (doc.enabled && doc.endTime && Date.now() >= doc.endTime) {
      doc.enabled = false; doc.endTime = null; doc.durationMinutes = 0;
      await doc.save();
      return res.json({ enabled: false });
    }
    const remain = doc.enabled && doc.endTime ? Math.max(0, doc.endTime - Date.now()) : 0;
    res.json({ enabled: doc.enabled, remainMs: remain, message: doc.message, durationMinutes: doc.durationMinutes, startedAt: doc.updatedAt || null });
  } catch { res.json({ enabled: false }); }
});

router.get('/maintenance/start', isAuthenticated, isOwner, async (req, res) => {
  try {
    const doc = await getOrCreateMaintenance();
    doc.enabled = true; doc.updatedAt = Date.now(); doc.updatedBy = req.session.user.id || '';
    await doc.save();
    syncMaintenanceToBot('start', doc.channelId);
    res.redirect('/dev');
  } catch (err) { res.redirect('/dev?error=' + encodeURIComponent(err.message)); }
});

router.get('/maintenance/stop', isAuthenticated, isOwner, async (req, res) => {
  try {
    const doc = await getOrCreateMaintenance();
    doc.enabled = false; doc.endTime = null; doc.durationMinutes = 0; doc.updatedAt = Date.now(); doc.updatedBy = req.session.user.id || '';
    await doc.save();
    syncMaintenanceToBot('stop', doc.channelId);
    res.redirect('/dev');
  } catch (err) { res.redirect('/dev?error=' + encodeURIComponent(err.message)); }
});

router.post('/maintenance/save', isAuthenticated, isOwner, async (req, res) => {
  try {
    const rawMinutes = parseInt(req.body.minutes || '0');
    const message = (req.body.message || '').trim();
    const channelId = (req.body.channelId || '').trim();
    const doc = await getOrCreateMaintenance();
    if (rawMinutes > 0) {
      doc.endTime = Date.now() + rawMinutes * 60 * 1000;
      doc.durationMinutes = rawMinutes;
    } else { doc.endTime = null; doc.durationMinutes = 0; }
    if (message) doc.message = message;
    if (channelId) doc.channelId = channelId;
    doc.updatedAt = Date.now(); doc.updatedBy = req.session.user.id || '';
    await doc.save();
    syncMaintenanceToBot(undefined, doc.channelId);
    res.redirect('/dev');
  } catch (err) { res.redirect('/dev?error=' + encodeURIComponent(err.message)); }
});

export default router;
