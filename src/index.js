import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import expressLayouts from 'express-ejs-layouts';
import config from './config.js';
import { securityMiddleware, validateCsrfToken } from './middleware/security.js';
import { setupWebSocket } from './websocket/index.js';
import { ROLE_HIERARCHY } from './middleware/auth.js';

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
import backupRoutes from './routes/backup.js';
import alertRoutes from './routes/alerts.js';
import statusRoutes from './routes/status.js';
import apiRoutes from './routes/api.js';
import devRoutes from './routes/dev.js';
import notificationRoutes from './routes/notifications.js';

import homeRoutes from './routes/home.js';

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
securityMiddleware(app);

// ─── Sessions ────────────────────────────────────────────────────────────
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: !config.isDev,
    maxAge: config.session.maxAge,
    httpOnly: true,
    sameSite: 'strict',
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
import { refreshDashboardRole } from './middleware/auth.js';
app.use(refreshDashboardRole);

// ─── Inject role level into all views ──────────────────────────────────
app.use((req, res, next) => {
  const role = req.session?.user?.dashboardRole || 'member';
  res.locals.roleLevel = ROLE_HIERARCHY[role] ?? -1;
  next();
});

// ─── Maintenance mode check ────────────────────────────────────────────
app.use(async (req, res, next) => {
  try {
    const skip = ['/', '/auth', '/maintenance', '/dev', '/static', '/css', '/js', '/fonts', '/favicon'];
    if (skip.some(s => req.path === s || req.path.startsWith(s + '/'))) return next();
  } catch { return next(); }

  if (req.session.maintenanceBypass) return next();

  try {
    const Maintenance = (await import('./models/Maintenance.js')).default;
    const doc = await Maintenance.findOne();
    if (doc && doc.enabled === true) {
      if (doc.endTime && Date.now() >= doc.endTime) {
        doc.enabled = false;
        doc.endTime = null;
        await doc.save();
        fetch(`${config.botApiUrl}/api/maintenance/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).catch(() => {});
        return next();
      }
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

// ─── Maintenance auto-end (called server-side, no CSRF) ────────────────
app.post('/maintenance/autoend', async (req, res) => {
  try {
    const Maintenance = (await import('./models/Maintenance.js')).default;
    const doc = await Maintenance.findOne();
    if (doc && doc.enabled && doc.endTime && Date.now() >= doc.endTime) {
      doc.enabled = false; doc.endTime = null; doc.durationMinutes = 0;
      await doc.save();
      fetch(`${config.botApiUrl}/api/maintenance/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).catch(() => {});
    }
    res.json({ ended: true });
  } catch { res.json({ ended: true }); }
});

app.use(validateCsrfToken);
app.use('/guilds', guildRoutes);
app.use('/settings', settingsRoutes);
app.use('/tickets', ticketRoutes);
app.use('/voice', voiceRoutes);
app.use('/admins', adminRoutes);
app.use('/logs', logRoutes);
app.use('/commands', commandRoutes);
app.use('/protection', protectionRoutes);
app.use('/backup', backupRoutes);
app.use('/alerts', alertRoutes);
app.use('/api', statusRoutes);
app.use('/api/user', apiRoutes);
app.use('/dev', devRoutes);
app.use('/notifications', notificationRoutes);

app.get('/maintenance', async (req, res) => {
  try {
    if (req.query.bypass === '1') {
      const user = req.session?.user;
      if (user && (user.isOwner || user.dashboardRole === 'developer' || user.dashboardRole === 'owner')) {
        req.session.maintenanceBypass = true;
        return res.redirect('/');
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
      fetch(`${config.botApiUrl}/api/maintenance/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).catch(() => {});
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
app.get('/invite-dev', (req, res) => {
  res.status(200).render('invite-dev', { layout: false, user: req.session?.user || null, title: 'خاصية قيد التطوير' });
});

// ─── Landing Page ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session?.user) {
    const role = req.session.user.dashboardRole || 'member';
    const level = ROLE_HIERARCHY[role] ?? -1;
    return res.redirect(level >= 3 ? '/dashboard' : '/home');
  }
  const errorMap = {
    auth_failed: 'auth_failed',
    no_code: 'no_code',
    access_denied: 'تم رفض الطلب — تأكد من الموافقة على جميع الصلاحيات',
  };
  res.render('index', {
    layout: false,
    user: req.session?.user || null,
    title: 'FX9 Dashboard — لوحة تحكم البوت',
    supportUrl: '#',
    error: errorMap[req.query.error] || null,
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
  console.log(`  FX9 Dashboard v1.0.0`);
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
