import { Router } from 'express';
import { isAuthenticated, isOwner } from '../middleware/auth.js';
import { getAllGuildConfig, getGuildAdmins, getActivity, getAuditLogs } from '../database.js';
import { getBotGuilds } from '../auth/discord.js';
import Maintenance from '../models/Maintenance.js';
import config from '../config.js';
import axios from 'axios';

const router = Router();

// ── Rich bot guilds (bot API -> Discord API fallback) ────────────────────
async function getRichBotGuilds() {
  try {
    const r = await fetch(`${config.botApiUrl}/api/guilds/full`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data?.guilds)) return data.guilds;
    }
  } catch {}
  try {
    const guilds = await getBotGuilds(config.discord.botToken);
    return (guilds || []).map(g => ({ id: g.id, name: g.name, icon: g.icon, memberCount: 0 }));
  } catch {}
  return [];
}

router.get('/', isAuthenticated, isOwner, async (req, res) => {
  const botGuilds = await getRichBotGuilds();

  const guildsData = [];
  for (const g of botGuilds) {
    const cfg = await getAllGuildConfig(g.id);
    const admins = await getGuildAdmins(g.id);
    guildsData.push({
      id: g.id,
      name: g.name,
      icon: g.icon,
      memberCount: g.memberCount || 0,
      configCount: Object.keys(cfg).length,
      adminCount: admins.length,
    });
  }
  guildsData.sort((a, b) => b.memberCount - a.memberCount);
  const totalMembers = guildsData.reduce((s, g) => s + g.memberCount, 0);

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
    changelog: maintenanceRaw?.changelog || { botUpdates: '', siteUpdates: '' },
  };

  const botInviteUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(config.discord.clientId || '')}&permissions=8&scope=bot`;

  res.render('dev', {
    user: req.session.user,
    botGuilds: guildsData,
    totalMembers,
    ownerId: config.discord.ownerId,
    botInviteUrl,
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

// ── Server invite link (join a connected server) ────────────────────────
router.get('/guild-invite/:guildId', isAuthenticated, isOwner, async (req, res) => {
  try {
    const r = await fetch(`${config.botApiUrl}/api/guilds/${req.params.guildId}/invite`, {
      signal: AbortSignal.timeout(7000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error || 'تعذر إنشاء رابط الدعوة' });
    }
    res.json(data);
  } catch {
    res.status(502).json({ error: 'تعذر الاتصال بالبوت' });
  }
});

// ── Maintenance mode start / stop / save ──────────────────────────────
async function getOrCreateMaintenance() {
  let doc = await Maintenance.findOne();
  if (!doc) doc = new Maintenance();
  return doc;
}

async function syncMaintenanceToBot(action, channelId, changelog) {
  try {
    const body = {};
    if (action) body.action = action;
    if (channelId) body.channelId = channelId;
    if (changelog) body.changelog = changelog;
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
    res.json({ enabled: doc.enabled, remainMs: remain, message: doc.message, durationMinutes: doc.durationMinutes, startedAt: doc.updatedAt || null, endTime: doc.endTime || null, changelog: doc.changelog || { botUpdates: '', siteUpdates: '' } });
  } catch { res.json({ enabled: false }); }
});

router.get('/maintenance/start', isAuthenticated, isOwner, async (req, res) => {
  try {
    const doc = await getOrCreateMaintenance();
    doc.enabled = true; doc.changelog = { botUpdates: '', siteUpdates: '' }; doc.updatedAt = Date.now(); doc.updatedBy = req.session.user.id || '';
    await doc.save();
    syncMaintenanceToBot('start', doc.channelId);
    res.redirect('/dev');
  } catch (err) { res.redirect('/dev?error=' + encodeURIComponent(err.message)); }
});

router.post('/maintenance/stop', isAuthenticated, isOwner, async (req, res) => {
  try {
    const doc = await getOrCreateMaintenance();
    const botUpdates = (req.body.botUpdates || '').trim();
    const siteUpdates = (req.body.siteUpdates || '').trim();
    const changelog = {
      botUpdates: botUpdates || 'لم يتم إضافة تحديثات',
      siteUpdates: siteUpdates || 'لم يتم إضافة تحديثات',
    };
    doc.changelog = changelog;
    doc.enabled = false; doc.endTime = null; doc.durationMinutes = 0; doc.updatedAt = Date.now(); doc.updatedBy = req.session.user.id || '';
    await doc.save();
    syncMaintenanceToBot('stop', doc.channelId, changelog);
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
