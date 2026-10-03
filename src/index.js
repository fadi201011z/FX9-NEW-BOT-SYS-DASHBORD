import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import expressLayouts from 'express-ejs-layouts';
import config from './config.js';
import { securityMiddleware } from './middleware/security.js';
import { setupWebSocket } from './websocket/index.js';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import guildRoutes from './routes/guilds.js';
import settingsRoutes from './routes/settings.js';
import ticketRoutes from './routes/tickets.js';
import voiceRoutes from './routes/voice.js';
import adminRoutes from './routes/admins.js';
import logRoutes from './routes/logs.js';
import commandRoutes from './routes/commands.js';
import protectionRoutes from './routes/protection.js';
import premiumRoutes from './routes/premium.js';
import backupRoutes from './routes/backup.js';
import alertRoutes from './routes/alerts.js';
import statusRoutes from './routes/status.js';
import apiRoutes from './routes/api.js';
import devRoutes from './routes/dev.js';
import notificationRoutes from './routes/notifications.js';

import homeRoutes from './routes/home.js';
import { botFetch, botPost } from './services/botApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Initialize Express ──────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

// ─── Security & Performance ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
securityMiddleware(app);

// ─── Sessions ────────────────────────────────────────────────────────────
// The store must be persistent. express-session's default MemoryStore keeps
// sessions in the process's RAM, so any restart wipes them — and this app
// restarts constantly on Render: every deploy replaces the container, and the
// free tier spins the service down after ~15 minutes idle.
//
// That broke Discord login specifically. The OAuth flow writes req.session.
// oauthState, bounces the user to Discord for consent, then reads that same
// state back on the callback. If the process restarted in between, the state
// was gone and every login died on `state !== savedState`, bouncing the user
// back to the landing page with ?error=invalid_state.
//
// Sessions now live in the MongoDB this app already depends on, so they
// survive restarts and work across instances.
function buildSessionStore() {
  try {
    return MongoStore.create({
      mongoUrl: config.mongodb.uri,
      collectionName: 'sessions',
      ttl: Math.floor(config.session.maxAge / 1000),
      autoRemove: 'native',
      // Expire idle sessions immediately rather than on write, so the TTL
      // index stays authoritative even if a session is never touched again.
      touchAfter: 0,
    });
  } catch (err) {
    // Keep login working if Mongo is unreachable at boot. MemoryStore is worse
    // than a database, but far better than sessions failing outright.
    console.error('[Session] Mongo store unavailable, falling back to MemoryStore:', err.message);
    return undefined;
  }
}

app.use(session({
  store: buildSessionStore(),
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: !config.isDev,
    maxAge: config.session.maxAge,
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// ─── View Engine ─────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// ─── Static Files ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auto-refresh dashboard role from DB ────────────────────────────────
import { refreshDashboardRole, getGuildPremium } from './middleware/auth.js';
import { resolve } from './services/capabilities.js';
app.use(refreshDashboardRole);

// ─── One permission object per request ──────────────────────────────────
// The guards on the routes, the locks in the sidebar and the buttons in the
// views all read this one object, so they cannot answer differently.
const GUILD_PATH_RE = /^\/(?:guilds|settings|commands|protection|premium|tickets|voice|logs|notifications|admins|backup|overview)\/([^/]+)/;
app.use(async (req, res, next) => {
  const user = req.session?.user;
  const m = req.path.match(GUILD_PATH_RE);
  const guildId = m && m[1] ? m[1] : null;

  const perms = await resolve(user, guildId);
  req.perms = perms;
  res.locals.perms = perms;
  res.locals.isDeveloper = perms.isDeveloper;
  // Still consumed by the older templates. Same number, now per-guild by
  // construction instead of by a second, disagreeing calculation.
  res.locals.roleLevel = perms.level;
  res.locals.guildRole = perms.role;

  // ── حالة البريميوم للسيرفر الحالي (للنقطة في القائمة الجانبية) ──
  res.locals.premiumStatus = { active: false, planId: null, planLabel: null };
  if (guildId) {
    try {
      res.locals.premiumStatus = await getGuildPremium(guildId);
    } catch {}
  }
  next();
});

// ─── Maintenance mode check ────────────────────────────────────────────
// كاش قصير (5 ثوانٍ) لتجنّب استعلام MongoDB في كل طلب
let maintenanceCache = { doc: null, ts: 0 };
const MAINTENANCE_CACHE_TTL = 5000;
app.use(async (req, res, next) => {
  try {
    const skip = ['/', '/auth', '/maintenance', '/dev', '/api', '/static', '/css', '/js', '/fonts', '/favicon'];
    if (skip.some(s => req.path === s || req.path.startsWith(s + '/'))) return next();
  } catch { return next(); }

  if (req.session?.maintenanceBypass) return next();

  try {
    const now = Date.now();
    if (now - maintenanceCache.ts > MAINTENANCE_CACHE_TTL || !maintenanceCache.doc) {
      const Maintenance = (await import('./models/Maintenance.js')).default;
      const doc = await Maintenance.findOne();
      if (doc && doc.enabled === true && doc.endTime && Date.now() >= doc.endTime) {
        doc.enabled = false;
        doc.endTime = null;
        await doc.save();
        botFetch(`${config.botApiUrl}/api/maintenance/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).catch(() => {});
        maintenanceCache = { doc: null, ts: Date.now() };
        return next();
      }
      maintenanceCache = { doc: doc ? doc.toObject() : null, ts: Date.now() };
    }
    const doc = maintenanceCache.doc;
    if (doc && doc.enabled === true) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(503).json({ error: 'maintenance', message: doc.message, endTime: doc.endTime });
      }
      return res.redirect('/maintenance');
    }
  } catch {}
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────
app.use('/home', homeRoutes);
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/guilds', guildRoutes);
app.use('/settings', settingsRoutes);
app.use('/tickets', ticketRoutes);
app.use('/voice', voiceRoutes);
app.use('/admins', adminRoutes);
app.use('/logs', logRoutes);
app.use('/commands', commandRoutes);
app.use('/protection', protectionRoutes);
app.use('/premium', premiumRoutes);
app.use('/backup', backupRoutes);
app.use('/alerts', alertRoutes);
app.use('/api', statusRoutes);
app.use('/api/user', apiRoutes);
app.use('/dev', devRoutes);
app.use('/notifications', notificationRoutes);


// ─── Documentation page ──────────────────────────────────────────────────
app.get('/docs', async (req, res) => {
  try {
    const { getDocumentation } = await import('./services/syncService.js');
    const commands = await getDocumentation();
    res.render('docs', { user: req.session?.user || null, commands, title: 'التوثيق' });
  } catch {
    res.render('docs', { user: req.session?.user || null, commands: [], title: 'التوثيق' });
  }
});

app.get('/docs/:category', async (req, res) => {
  try {
    const { getDocumentation } = await import('./services/syncService.js');
    const all = await getDocumentation();
    const commands = all.filter(c => c.category === req.params.category);
    res.render('docs', { user: req.session?.user || null, commands, category: req.params.category, title: `التوثيق — ${req.params.category}` });
  } catch {
    res.render('docs', { user: req.session?.user || null, commands: [], title: 'التوثيق' });
  }
});

app.get('/status', (req, res) => {
  res.render('status', { user: req.session?.user || null, title: 'حالة البوت' });
});

// ─── Access Denied ───────────────────────────────────────────────────────
app.get('/access-denied', (req, res) => {
  res.status(403).render('access-denied', { layout: false, user: req.session?.user || null, title: 'لا يمكنك الدخول', clientId: config.discord.clientId, reason: req.query.reason || 'owner' });
});

// ─── Maintenance ─────────────────────────────────────────────────────────
app.post('/maintenance/autoend', async (req, res) => {
  try {
    const Maintenance = (await import('./models/Maintenance.js')).default;
    const doc = await Maintenance.findOne();
    if (doc && doc.enabled && doc.endTime && Date.now() >= doc.endTime) {
      doc.enabled = false; doc.endTime = null; doc.durationMinutes = 0;
      await doc.save();
      botFetch(`${config.botApiUrl}/api/maintenance/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).catch(() => {});
    }
    res.json({ ended: true });
  } catch { res.json({ ended: true }); }
});

app.get('/maintenance', async (req, res) => {
  try {
    if (req.query.bypass === '1') {
      const user = req.session?.user;
      if (user && (user.isOwner || user.dashboardRole === 'developer' || user.dashboardRole === 'owner')) {
        req.session.maintenanceBypass = true;
        req.session.save(() => { res.redirect('/'); });
        return;
      }
    }
  } catch {}

  let maintenanceRaw = null;
  try {
    const Maintenance = (await import('./models/Maintenance.js')).default;
    maintenanceRaw = await Maintenance.findOne();
    if (maintenanceRaw && maintenanceRaw.enabled && maintenanceRaw.endTime && Date.now() >= maintenanceRaw.endTime) {
      maintenanceRaw.enabled = false;
      maintenanceRaw.endTime = null;
      await maintenanceRaw.save();
      botFetch(`${config.botApiUrl}/api/maintenance/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).catch(() => {});
      maintenanceRaw = maintenanceRaw.toObject();
    } else if (maintenanceRaw) {
      maintenanceRaw = maintenanceRaw.toObject();
    }
  } catch {}
  const isPreview = req.query.preview === '1';
  const maintenance = {
    enabled: isPreview ? true : !!(maintenanceRaw?.enabled),
    endTime: maintenanceRaw?.endTime || null,
    durationMinutes: maintenanceRaw?.durationMinutes || 0,
    message: maintenanceRaw?.message || 'الموقع تحت الصيانة حالياً. سنعود قريباً!',
  };
  const user = req.session?.user;
  const canBypass = !!(user && (user.isOwner || user.dashboardRole === 'developer' || user.dashboardRole === 'owner'));
  res.status(isPreview ? 200 : 503).render('maintenance', { layout: false, user, maintenance, canBypass, title: 'تحت الصيانة' });
});

// ─── Invite (Under Development) ──────────────────────────────────────────
// Was /invite-dev. The suffix said what the page is doing, not what it is, and
// it was in the address bar of every "add the bot" link on the site. It is now
// /invite, and /invite-dev redirects to it permanently rather than 404ing, so
// the links already shared elsewhere — and any bookmark — still land somewhere.
//
// The page is a sibling of /premium: same site furniture, same glass card, the
// same stylesheet. Still under development, still saying so.
app.get('/invite', (req, res) => {
  res.status(200).render('invite', {
    layout: false,
    page: 'invite',
    user: req.session?.user || null,
    title: 'دعوة البوت — قيد التطوير',
  });
});

// 301, not 302: the old address is never coming back, so let caches and search
// engines settle on the new one.
app.get('/invite-dev', (req, res) => res.redirect(301, '/invite'));

// ─── Premium (Under Development) ─────────────────────────────────────────
// The page is still the same message it has always been — under development —
// but it now wears the site's own design: the shared landing header, the
// starfield and purple radial, a glass card, the site buttons, the shared wave
// and footer. page: 'premium' is passed for the header's current-page marking,
// the way /commands passes its own.
app.get('/premium', (req, res) => {
  res.status(200).render('premium', {
    layout: false,
    page: 'premium',
    user: req.session?.user || null,
    title: 'البريميوم — قريباً',
  });
});

// ─── Landing Page ────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  // ─── Recovery for a misconfigured CALLBACK_URL ─────────────────────────────
  // Discord returns the user to whatever redirect_uri is registered with it.
  // If CALLBACK_URL holds only the bare origin, the authorization code and
  // state are delivered to this route instead of the callback handler, where
  // nothing reads them. The visitor is then shown the landing page and login
  // fails silently — no error message, no hint of what went wrong.
  //
  // Forward the pair to the real handler so a wrong CALLBACK_URL degrades into
  // a working login rather than a dead end. The CSRF state check still runs in
  // the callback route, unchanged: this only moves the request, it does not
  // weaken the guard. Once CALLBACK_URL names the path, Discord goes straight
  // there and this branch never runs.
  //
  // Both code and state must be present and be strings. A repeated ?code=a&code=b
  // parses to an array, and a lone ?code= is not an OAuth response.
  const { code, error: oauthError, state } = req.query;
  if (typeof state === 'string' && state &&
      (typeof code === 'string' || typeof oauthError === 'string')) {
    const qs = new URLSearchParams();
    if (typeof code === 'string') qs.set('code', code);
    if (typeof oauthError === 'string') qs.set('error', oauthError);
    qs.set('state', state);
    return res.redirect(`/auth/discord/callback?${qs}`);
  }

  if (req.session?.user) {
    const perms = await resolve(req.session.user, null);
    return res.redirect(perms.can.dashboard ? '/dashboard' : '/home');
  }
  const errorMap = {
    auth_failed: 'auth_failed',
    no_code: 'no_code',
    access_denied: 'تم رفض الطلب — تأكد من الموافقة على جميع الصلاحيات',
  };

  let cmdStats = null;
  let botStats = null;
  try {
    const [cmdRes, botRes] = await Promise.all([
      botFetch(`${config.botApiUrl}/api/commands/stats`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
      botFetch(`${config.botApiUrl}/api/stats`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
    ]);
    if (cmdRes && cmdRes.ok) cmdStats = await cmdRes.json();
    if (botRes && botRes.ok) botStats = await botRes.json();
  } catch {}

  res.render('index', {
    layout: false,
    user: req.session?.user || null,
    page: 'home',
    title: 'Kratos Dashboard — لوحة تحكم البوت',
    supportUrl: '#',
    error: errorMap[req.query.error] || null,
    stats: { cmd: cmdStats, bot: botStats },
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { layout: false, message: 'الصفحة غير موجودة.', user: req.session?.user || null });
});

// ─── Error Handler ───────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).render('error', { layout: false, message: 'حدث خطأ داخلي في الخادم.', user: req.session?.user || null });
});

// ─── Start Server ────────────────────────────────────────────────────────
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Kratos Dashboard v1.0.0`);
  console.log(`  Server  → http://localhost:${config.port}`);
  console.log(`  Mode    → ${config.nodeEnv}`);
  console.log(`  WS      → ws://localhost:${config.port}/ws`);
  console.log('═══════════════════════════════════════════════════');
});

// ─── Periodic Admin Sync (every 5 minutes) ──────────────────────────────────
import { getAllGuildIdsWithAdminRoles } from './database.js';
setInterval(async () => {
  try {
    const guildIds = await getAllGuildIdsWithAdminRoles();
    if (guildIds.length === 0) return;
    const { autoSyncAdmins } = await import('./routes/admins.js');
    for (const guildId of guildIds) {
      try {
        const result = await autoSyncAdmins(guildId, 'system');
        if (result.added > 0 || result.removed > 0) {
          console.log(`[AdminSync] ${guildId}: +${result.added} / -${result.removed}`);
        }
      } catch {}
    }
  } catch (err) {
    console.error('[AdminSync] Error:', err.message);
  }
}, 300_000);

// ─── WebSocket ───────────────────────────────────────────────────────────
const ws = setupWebSocket(server);
export { ws };
