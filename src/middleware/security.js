import config from '../config.js';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

// ─── Rate Limiters ─────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'طلبات كثيرة جداً، حاول مرة أخرى لاحقاً' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'محاولات دخول كثيرة، انتظر دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'طلبات كثيرة، حاول مرة أخرى لاحقاً' },
  standardHeaders: true,
  legacyHeaders: false,
});

const devLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'طلبات كثيرة على لوحة المطور' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Rate limiter for brute force (auth) ───────────────────────────────
const bruteStore = new Map();

function bruteForceProtection(ip) {
  const now = Date.now();
  const entry = bruteStore.get(ip);
  if (!entry) {
    bruteStore.set(ip, { count: 1, firstAttempt: now, blocked: false, blockUntil: 0 });
    return false;
  }
  if (entry.blocked && now < entry.blockUntil) return true;
  if (entry.blocked && now >= entry.blockUntil) {
    bruteStore.delete(ip);
    return false;
  }
  if (now - entry.firstAttempt > 60000) {
    bruteStore.set(ip, { count: 1, firstAttempt: now, blocked: false, blockUntil: 0 });
    return false;
  }
  entry.count++;
  if (entry.count >= 10) {
    entry.blocked = true;
    entry.blockUntil = now + 300000;
    console.warn(`[Security] IP ${ip} blocked for 5 minutes (brute force)`);
  }
  return false;
}

function resetBruteForce(ip) {
  bruteStore.delete(ip);
}

// ─── CSRF ──────────────────────────────────────────────────────────────
function generateCsrfToken(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = uuidv4();
  }
  res.locals.csrfToken = req.session?.csrfToken || '';
  next();
}

function validateCsrfToken(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const token = req.body?._csrf || req.headers['x-csrf-token'];
    if (!token || !req.session || token !== req.session.csrfToken) {
      console.warn(`[Security] CSRF failed for ${req.method} ${req.path} from ${req.ip}`);
      return res.status(403).json({ error: 'طلب غير مصرح به (CSRF)' });
    }
  }
  next();
}

// ─── Input Sanitization ────────────────────────────────────────────────
const MONGODB_PATTERN = /\$?(gt|gte|lt|lte|ne|eq|in|nin|regex|exists|where|and|or|nor|not|all|size|elemMatch)/i;

function sanitizeValue(val) {
  if (typeof val === 'string') {
    let cleaned = val.replace(/[<>]/g, '');
    if (MONGODB_PATTERN.test(cleaned)) {
      cleaned = cleaned.replace(MONGODB_PATTERN, '');
    }
    return cleaned.trim();
  }
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (val && typeof val === 'object') return sanitizeObject(val);
  return val;
}

function sanitizeObject(obj) {
  const cleaned = {};
  for (const key of Object.keys(obj)) {
    if (MONGODB_PATTERN.test(key)) continue;
    cleaned[key] = sanitizeValue(obj[key]);
  }
  return cleaned;
}

function sanitizeInput(req, res, next) {
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (MONGODB_PATTERN.test(key)) delete req.query[key];
    }
  }
  next();
}

// ─── Security header overrides ─────────────────────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isDev) {
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: ws: wss:; img-src 'self' https: data:;");
  } else {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self' ws: wss:;");
  }
  next();
}

// ─── Suspicious activity log ───────────────────────────────────────────
function suspiciousLogger(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress;
  const ua = req.headers['user-agent'] || 'unknown';

  if (!ua || ua.length < 10 || ua === 'unknown') {
    console.warn(`[Security] Suspicious UA from ${ip}: ${ua}`);
  }
  if (req.path.includes('..') || req.path.includes('%00')) {
    console.warn(`[Security] Path traversal attempt from ${ip}: ${req.path}`);
    return res.status(400).json({ error: 'طلب غير صالح' });
  }
  if (req.path.length > 500) {
    console.warn(`[Security] Long path from ${ip}: ${req.path.length} chars`);
    return res.status(400).json({ error: 'طلب طويل جداً' });
  }
  next();
}

// ─── Main middleware loader ────────────────────────────────────────────
export function securityMiddleware(app) {
  app.use(securityHeaders);
  app.use(suspiciousLogger);
  app.use(globalLimiter);

  app.use('/auth', authLimiter);
  app.use('/dev', devLimiter);
  app.use('/api', strictLimiter);

  app.use(generateCsrfToken);
  app.use(sanitizeInput);
}

export { validateCsrfToken, sanitizeInput, resetBruteForce, bruteForceProtection };
