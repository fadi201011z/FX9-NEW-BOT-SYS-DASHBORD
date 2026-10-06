import { Router } from 'express';
import { isAuthenticated, isOwnerOrDeveloper } from '../middleware/auth.js';
import { getAllGuildConfig, getGuildAdmins, getActivity, getAuditLogs, logActivity } from '../database.js';
import { getBotGuilds, getBotSelf } from '../auth/discord.js';
import Maintenance from '../models/Maintenance.js';
import BotDeveloper from '../models/BotDeveloper.js';
import Feature from '../models/Feature.js';
import { FEATURE_CATALOG, FEATURE_GROUPS, FEATURE_STATES, STATE_META, FOLDER_TO_FEATURE } from '../services/featureCatalog.js';
import { invalidate } from '../services/capabilities.js';
import config from '../config.js';
import axios from 'axios';
import { botFetch, botPost } from '../services/botApi.js';

const router = Router();

// A Discord user id is 17-20 digits. Checked before it reaches the database so
// a typo cannot create an unreachable row nobody can ever remove.
const DISCORD_ID_RE = /^\d{17,20}$/;

// Result of the developer add/remove forms, mapped back to a sentence. Codes
// only travel in the URL -- the text is looked up here, so nothing a caller
// sends ends up on the page as-is.
const DEV_OK = { added: 'تمت إضافة المطور بنجاح', removed: 'تمت إزالة المطور' };
const DEV_ERR = {
  'bad-id': 'Discord ID غير صحيح — يجب أن يكون 17-20 رقماً',
  'self': 'هذا الحساب هو المالك ويملك الصلاحية بالفعل',
  'exists': 'هذا الشخص مطور بالفعل',
  'missing': 'هذا الشخص ليس مطوراً',
  'db': 'تعذّر تنفيذ العملية، حاول مرة أخرى',
  'denied': 'إضافة أو إزالة المطورين متاحة للمالك فقط',
};

// ── Rich bot guilds (bot API -> Discord API fallback) ────────────────────
async function getRichBotGuilds() {
  try {
    const r = await botFetch(`${config.botApiUrl}/api/guilds/full`, { signal: AbortSignal.timeout(4000) });
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

router.get('/', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
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

  let developers = [];
  try {
    developers = await BotDeveloper.find({}).sort({ addedAt: -1 }).lean();
  } catch {}

  let notice = null;
  if (req.query.ok && DEV_OK[req.query.ok]) {
    notice = { kind: 'ok', text: DEV_OK[req.query.ok] };
  } else if (req.query.err && DEV_ERR[req.query.err]) {
    notice = { kind: 'err', text: DEV_ERR[req.query.err] };
  }

  res.render('dev', {
    user: req.session.user,
    botGuilds: guildsData,
    totalMembers,
    ownerId: config.discord.ownerId,
    botInviteUrl,
    maintenance,
    developers,
    notice,
    isOwner: req.perms?.isOwner || false,
    title: 'لوحة المطور',
  });
});

// ── The developer section's placeholder pages ────────────────────────────
// Each carries its own currentPage, so the rail lights exactly one row of the
// section, and each stands behind the same two middlewares as /dev itself: the
// section is drawn from perms.can.dev, so a row nobody may press must not be
// reachable by typing its address either.
//
// One table and one loop because the rest are structurally identical today
// -- a heading and nothing under it. /dev/bot, /dev/status, /dev/guilds and
// /dev/features all used to sit in this table; each left when it grew data of
// its own and is now an ordinary route below, and the table keeps the rest.
// Which page is which is
// therefore written down once, and the two addresses, the two currentPages and
// the two titles cannot drift apart the way two hand-written routes would.
//
// The two left are namespaced under /dev on purpose, and one of them collides
// with a word the site already uses: /guilds is the account's own server list.
// Give it a flat address here and one page would answer to two names, two rows
// of the rail would light together on it, and the public page would inherit the
// developer's permissions. /status was the other collision and still lives
// under /dev even now that it has its own route, because the public /status is
// the same name for a different reader -- a logged-out visitor.
const DEV_PAGES = [
  { path: 'maintenance', view: 'dev/maintenance', page: 'dev-maintenance', title: 'وضع الصيانة' },
];

for (const page of DEV_PAGES) {
  router.get('/' + page.path, isAuthenticated, isOwnerOrDeveloper, (req, res) => {
    res.render(page.view, { user: req.session.user, title: page.title });
  });
}

// ── Bot management (identity, invite builder, live health) ───────────────
// Rebuilt from a placeholder. The page needs data no static view can carry:
// the bot's own Discord identity (name + avatar, read with the bot token),
// the configured client/owner ids, and the current developer list. Live
// health, diagnostics and command counts are fetched by the page itself from
// the /api routes that already serve them, so nothing here duplicates them.
router.get('/bot', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  const clientId = config.discord.clientId || '';
  const ownerId = config.discord.ownerId || '';
  const botInviteUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=8&scope=bot`;

  // Null when there is no token or Discord is unreachable; the view then falls
  // back to the client id and the default avatar instead of failing.
  const botSelf = await getBotSelf(config.discord.botToken);

  let developers = [];
  try {
    developers = await BotDeveloper.find({}).sort({ addedAt: -1 }).lean();
  } catch {}

  res.render('dev/bot', {
    user: req.session.user,
    clientId,
    ownerId,
    botSelf,
    botInviteUrl,
    developers,
    isOwner: req.perms?.isOwner || false,
    title: 'إدارة البوت',
  });
});

// ── Developer status (a superset of the public /status) ──────────────────
// Every number on the page comes from the routes that already serve it
// (status, diagnostics, bot info, commands, tickets) plus the maintenance
// endpoint; nothing is read at render time and nothing is invented. It left
// the table above once it grew past a heading, and it stayed under /dev
// because /status is the public board a logged-out visitor reads -- same name,
// different reader, so it must not share the address.
router.get('/status', isAuthenticated, isOwnerOrDeveloper, (req, res) => {
  res.render('dev/status', {
    user: req.session.user,
    isOwner: req.perms?.isOwner || false,
    title: 'حالة البوت',
  });
});

// ── Connected servers (a page in the section that draws live data) ───────
// It left the table above because it needs the bot's guild list with the same
// two counts /dev draws, and because every row is a join link: the page asks
// /guild-invite/:guildId only when a user presses a row, so no invite is minted
// for a page nobody looked at. The invite address itself is created by the bot,
// not here.
router.get('/guilds', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  const richGuilds = await getRichBotGuilds();

  const botGuilds = [];
  for (const g of richGuilds) {
    const cfg = await getAllGuildConfig(g.id);
    const admins = await getGuildAdmins(g.id);
    botGuilds.push({
      id: g.id,
      name: g.name,
      icon: g.icon,
      memberCount: g.memberCount || 0,
      configCount: Object.keys(cfg).length,
      adminCount: admins.length,
    });
  }
  botGuilds.sort((a, b) => b.memberCount - a.memberCount);

  const botInviteUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(config.discord.clientId || '')}&permissions=8&scope=bot`;

  res.render('dev/guilds', {
    user: req.session.user,
    botGuilds,
    botInviteUrl,
    title: 'السيرفرات المتصلة',
  });
});

router.get('/guild/:guildId', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
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
router.get('/guild-invite/:guildId', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  try {
    const r = await botFetch(`${config.botApiUrl}/api/guilds/${req.params.guildId}/invite`, {
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
    await botPost(`${config.botApiUrl}/api/maintenance/sync`, body, { timeout: 3000 });
  } catch {}
}

// Public on purpose, and the only unguarded route in this file.
//
// This is what the maintenance page shows every visitor, so its payload (the
// message, the countdown, the changelog) is public by design. It cannot move
// out of /dev without breaking `partials/landing-script.ejs`, which polls this
// exact URL from every public page and is byte-frozen. Every route that
// *changes* something is guarded below.
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

router.get('/maintenance/start', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  try {
    const doc = await getOrCreateMaintenance();
    doc.enabled = true; doc.changelog = { botUpdates: '', siteUpdates: '' }; doc.updatedAt = Date.now(); doc.updatedBy = req.session.user.id || '';
    await doc.save();
    syncMaintenanceToBot('start', doc.channelId);
    res.redirect('/dev');
  } catch (err) { res.redirect('/dev?error=' + encodeURIComponent(err.message)); }
});

router.post('/maintenance/stop', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
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

router.post('/maintenance/save', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
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

// ─── Feature switchboard (/dev/features) ────────────────────────────────
// The control plane for the bot's features. Each feature has one of three
// states: on, off, or maintenance. The dashboard owns the decision (this DB)
// and pushes it to the bot so it takes effect immediately; the bot also polls
// the same collection, so a missed push still lands within a few seconds.
//
// The write routes answer JSON rather than redirecting: the page is a live
// switchboard and should not reload on every toggle. Reads are server-rendered
// so the page has real content before any script runs.
async function readFeatureState() {
  let docs = [];
  try {
    docs = await Feature.find({}).lean();
  } catch {}
  const stored = new Map(docs.map((d) => [d.key, d]));
  return FEATURE_CATALOG.map((f) => {
    const d = stored.get(f.key);
    return {
      ...f,
      state: FEATURE_STATES.includes(d?.state) ? d.state : 'on',
      message: d?.message || '',
      updatedAt: d?.updatedAt || 0,
      updatedBy: d?.updatedBy || '',
    };
  });
}

function countFeatureStates(list) {
  const c = { on: 0, off: 0, maintenance: 0 };
  for (const f of list) if (c[f.state] != null) c[f.state]++;
  return c;
}

async function pushFeatureToBot(key, state, message, updatedBy) {
  try {
    await botPost(`${config.botApiUrl}/api/features/sync`, { key, state, message, updatedBy }, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

router.get('/features', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  const features = await readFeatureState();
  res.render('dev/features', {
    user: req.session.user,
    title: 'حالة الخصائص',
    features,
    counts: countFeatureStates(features),
    groups: FEATURE_GROUPS,
    stateMeta: STATE_META,
    states: FEATURE_STATES,
    folderToFeature: FOLDER_TO_FEATURE,
  });
});

// The bot's own view of the flags, used only for the "synced" badge. Never
// throws: an unreachable bot is a state the page draws, not an error.
router.get('/features/live', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  try {
    const r = await botFetch(`${config.botApiUrl}/api/features`, { signal: AbortSignal.timeout(3500) });
    if (!r.ok) throw new Error('http ' + r.status);
    const data = await r.json();
    res.json({ online: true, features: Array.isArray(data?.features) ? data.features : [] });
  } catch (err) {
    res.json({ online: false, features: [], error: String(err?.message || err) });
  }
});

// NOTE: declared before /features/:key, otherwise "bulk" would be read as a key.
router.post('/features/bulk', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  const state = FEATURE_STATES.includes(req.body?.state) ? req.body.state : null;
  const rawKeys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  const known = new Set(FEATURE_CATALOG.map((f) => f.key));
  const keys = rawKeys.filter((k) => typeof k === 'string' && known.has(k));
  if (!state || !keys.length) return res.status(400).json({ ok: false, error: 'bad-request' });

  const by = req.session.user.id || '';
  const now = Date.now();
  const updated = [];
  for (const key of keys) {
    try {
      await Feature.updateOne({ key }, { $set: { key, state, updatedAt: now, updatedBy: by } }, { upsert: true });
    } catch (err) {
      console.error('[dev/features/bulk]', err);
      return res.status(500).json({ ok: false, error: 'db' });
    }
    updated.push({ key, synced: await pushFeatureToBot(key, state, '', by) });
  }
  await logActivity(by, null, 'dev.feature.bulk', state, `تبديل ${keys.length} خصيصة إلى «${state}»`, req.ip, req.sessionID);
  res.json({ ok: true, state, updated });
});

router.post('/features/:key', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  const key = String(req.params.key || '');
  const feature = FEATURE_CATALOG.find((f) => f.key === key);
  if (!feature) return res.status(404).json({ ok: false, error: 'unknown' });

  const state = FEATURE_STATES.includes(req.body?.state) ? req.body.state : 'on';
  const message = String(req.body?.message || '').trim().slice(0, 300);
  const by = req.session.user.id || '';
  const now = Date.now();

  try {
    await Feature.updateOne({ key }, { $set: { key, state, message, updatedAt: now, updatedBy: by } }, { upsert: true });
  } catch (err) {
    console.error('[dev/features]', err);
    return res.status(500).json({ ok: false, error: 'db' });
  }

  const synced = await pushFeatureToBot(key, state, message, by);
  await logActivity(by, null, 'dev.feature.set', key, `ضبط خصيصة «${key}» على «${state}»`, req.ip, req.sessionID);
  res.json({ ok: true, key, state, message, updatedAt: now, updatedBy: by, synced });
});

// ─── Who counts as a bot developer ──────────────────────────────────────
// Adding a developer hands out /dev, so only the owner can do it. A developer
// who could promote themselves would make the owner gate meaningless.
//
// These two redirect rather than answer with JSON, so the form works with
// scripting turned off and nothing here depends on a toast helper.

function devRedirect(res, param, key) {
  res.redirect('/dev?' + param + '=' + encodeURIComponent(key));
}

router.post('/developers', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  if (!req.perms?.isOwner) return devRedirect(res, 'err', 'denied');

  const userId = String(req.body?.userId || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 200);
  const username = String(req.body?.username || '').trim().slice(0, 64);

  if (!DISCORD_ID_RE.test(userId)) return devRedirect(res, 'err', 'bad-id');
  if (userId === config.discord.ownerId) return devRedirect(res, 'err', 'self');

  try {
    const existing = await BotDeveloper.findOne({ userId }).collation({ locale: 'en', strength: 2 }).lean();
    if (existing) return devRedirect(res, 'err', 'exists');
    await BotDeveloper.create({
      userId,
      username: username || undefined,
      note: note || undefined,
      addedBy: req.session.user.id,
    });
    invalidate(userId);
    await logActivity(req.session.user.id, null, 'dev.add', userId, `أضاف مطور: ${userId}`, req.ip, req.sessionID);
    devRedirect(res, 'ok', 'added');
  } catch (err) {
    console.error('[dev/developers]', err);
    devRedirect(res, 'err', 'db');
  }
});

router.post('/developers/remove', isAuthenticated, isOwnerOrDeveloper, async (req, res) => {
  if (!req.perms?.isOwner) return devRedirect(res, 'err', 'denied');

  const userId = String(req.body?.userId || '').trim();
  if (!DISCORD_ID_RE.test(userId)) return devRedirect(res, 'err', 'bad-id');

  try {
    const removed = await BotDeveloper.findOneAndDelete({ userId })
      .collation({ locale: 'en', strength: 2 });
    if (!removed) return devRedirect(res, 'err', 'missing');
    // Without this the permission stays live in memory for up to 30 seconds
    // after the row is gone.
    invalidate(userId);
    await logActivity(req.session.user.id, null, 'dev.remove', userId, `أزال مطور: ${userId}`, req.ip, req.sessionID);
    devRedirect(res, 'ok', 'removed');
  } catch (err) {
    console.error('[dev/developers/remove]', err);
    devRedirect(res, 'err', 'db');
  }
});

export default router;
