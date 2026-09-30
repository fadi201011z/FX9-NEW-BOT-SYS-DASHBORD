import config from '../config.js';
import rateLimit from 'express-rate-limit';

export function securityMiddleware(app) {
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (config.isDev) {
      res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data:; img-src 'self' https: data:;");
    } else {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self' ws: wss:;");
    }
    next();
  });

  const limiter = rateLimit({
    windowMs: config.security.rateLimitWindow,
    max: config.security.rateLimitMax,
    message: { error: 'Too many requests, try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  // ─── حد صارم على تدفق تسجيل الدخول ─────────────────────────────────────
  // يمنع إغراق نقطة OAuth منبثقة (وتسريع تخمين رموز التفويض).
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many login attempts. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/auth/discord', authLimiter);
  app.use('/auth/discord/callback', authLimiter);
}

// ─── حارس محاولات الأكواد السرية ───────────────────────────────────────────
// يُستخدم على تفعيل الاشتراك: حد أعلى للمحاولات الفاشلة لكل (مستخدم + سيرفر).
// بدونه يستطيع أحد إنشاء سيرفر وهمي، أن يكون أدمن فيه، ثم تخمين الكود.
export function createAttemptLimiter({ max = 5, windowMs = 60 * 60 * 1000 } = {}) {
  const attempts = new Map();

  // تنظيف دوري حتى لا تتضخم الخريطة في الذاكرة
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, rec] of attempts) {
      if (now - rec.first > windowMs) attempts.delete(key);
    }
  }, windowMs);
  if (sweeper.unref) sweeper.unref();

  return {
    /** يسجّل محاولة فاشلة. يرجع true إن تجاوز الحد. */
    fail(key) {
      const now = Date.now();
      const rec = attempts.get(key);
      if (!rec || now - rec.first > windowMs) {
        attempts.set(key, { count: 1, first: now });
        return false;
      }
      rec.count += 1;
      return rec.count >= max;
    },
    /** ينظّف السجل بعد نجاح */
    clear(key) {
      attempts.delete(key);
    },
    isLocked(key) {
      const rec = attempts.get(key);
      if (!rec) return false;
      if (Date.now() - rec.first > windowMs) {
        attempts.delete(key);
        return false;
      }
      return rec.count >= max;
    },
  };
}

export function sanitizeInput(req, res, next) {
  if (req.body) {
    for (const key of Object.keys(req.body)) {
      req.body[key] = cleanValue(req.body[key]);
    }
  }
  next();
}

function cleanValue(value) {
  if (typeof value === 'string') {
    return value.replace(/[<>]/g, '').trim();
  }
  if (Array.isArray(value)) {
    return value.map(cleanValue);
  }
  if (value && typeof value === 'object') {
    const cleaned = {};
    for (const k of Object.keys(value)) {
      cleaned[k] = cleanValue(value[k]);
    }
    return cleaned;
  }
  return value;
}
