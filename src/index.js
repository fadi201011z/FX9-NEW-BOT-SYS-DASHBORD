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
import { securityMiddleware } from './middleware/security.js';
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

// ─── Inject role level into all views ──────────────────────────────────
app.use((req, res, next) => {
  const role = req.session?.user?.dashboardRole || 'member';
  res.locals.roleLevel = ROLE_HIERARCHY[role] ?? -1;
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
app.use('/backup', backupRoutes);
app.use('/alerts', alertRoutes);
app.use('/api', statusRoutes);
app.use('/api/user', apiRoutes);
app.use('/dev', devRoutes);


// ─── Documentation page ──────────────────────────────────────────────────
app.get('/docs', async (req, res) => {
  try {
    const { getDocumentation } = await import('./services/syncService.js');
    const commands = await getDocumentation();
    res.render('docs', { user: req.session.user, commands, title: 'التوثيق' });
  } catch {
    res.render('docs', { user: req.session.user, commands: [], title: 'التوثيق' });
  }
});

app.get('/docs/:category', async (req, res) => {
  try {
    const { getDocumentation } = await import('./services/syncService.js');
    const all = await getDocumentation();
    const commands = all.filter(c => c.category === req.params.category);
    res.render('docs', { user: req.session.user, commands, category: req.params.category, title: `التوثيق — ${req.params.category}` });
  } catch {
    res.render('docs', { user: req.session.user, commands: [], title: 'التوثيق' });
  }
});

app.get('/status', (req, res) => {
  res.render('status', { user: req.session.user, title: 'حالة البوت' });
});

// ─── Access Denied ───────────────────────────────────────────────────────
app.get('/access-denied', (req, res) => {
  res.status(403).render('access-denied', { layout: false, user: req.session.user, title: 'لا يمكنك الدخول', clientId: config.discord.clientId });
});

// ─── Maintenance ─────────────────────────────────────────────────────────
app.get('/maintenance', (req, res) => {
  res.status(503).render('maintenance', { layout: false, user: req.session.user, title: 'تحت الصيانة' });
});

// ─── Landing Page ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session?.user) {
    return res.redirect(req.session.user.isOwner ? '/dashboard' : '/home');
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
    inviteUrl: '/maintenance',
    supportUrl: '#',
    error: errorMap[req.query.error] || null,
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { layout: false, message: 'الصفحة غير موجودة.', user: req.session.user });
});

// ─── Error Handler ───────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).render('error', { layout: false, message: 'حدث خطأ داخلي في الخادم.', user: req.session.user });
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
