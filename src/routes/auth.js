import { Router } from 'express';
import { upsertUser, getUserAdminGuilds } from '../database.js';
import { getAuthUrl, generateState, exchangeCode, getUserInfo, getUserGuilds, refreshToken } from '../auth/discord.js';
import config from '../config.js';

const router = Router();

// ─── حارس CSRF لتدفق OAuth ────────────────────────────────────────────────
// بدون state، يمكن لمهاجم بناء رابط تسجيل دخول يربط حساب الضحية
// بحسابه (login CSRF). نولّد قيمة عشوائية ونربطها بالجلسة.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 دقائق

router.get('/discord', (req, res) => {
  const state = generateState();
  req.session.oauthState = state;
  req.session.oauthStateAt = Date.now();
  res.redirect(getAuthUrl(state));
});

router.get('/discord/callback', async (req, res) => {
  try {
    const { code, error: discordError, state } = req.query;
    if (discordError) return res.redirect(`/?error=${discordError}`);
    if (!code) return res.redirect('/?error=no_code');

    // ─── التحقق من state ─────────────────────────────────────────────────
    const savedState = req.session.oauthState;
    const savedAt = req.session.oauthStateAt || 0;
    delete req.session.oauthState;
    delete req.session.oauthStateAt;

    if (!savedState || !state || state !== savedState) {
      console.warn('[Auth] OAuth state mismatch — possible CSRF attempt.');
      return res.redirect('/?error=invalid_state');
    }
    if (Date.now() - savedAt > STATE_TTL_MS) {
      return res.redirect('/?error=state_expired');
    }

    const tokenData = await exchangeCode(code);
    const discordUser = await getUserInfo(tokenData.access_token);

    let guilds = [];
    try {
      guilds = await getUserGuilds(tokenData.access_token);
    } catch {}

    await upsertUser(discordUser.id, discordUser.username, discordUser.avatar);

    const adminGuilds = await getUserAdminGuilds(discordUser.id);
    const bestAdmin = adminGuilds.length > 0
      ? adminGuilds.reduce((a, b) => {
          const hierarchy = { owner: 4, manager: 3, admin: 2, moderator: 1, support: 0 };
          return (hierarchy[a.role] || 0) >= (hierarchy[b.role] || 0) ? a : b;
        })
      : null;

    const isOwner = discordUser.id === config.discord.ownerId;
    const hasManageGuild = guilds.some(g => {
      const p = BigInt(g.permissions);
      return (p & 0x20n) === 0x20n || (p & 0x8n) === 0x8n;
    });
    const canAccess = isOwner || hasManageGuild || bestAdmin !== null;

    if (!canAccess) {
      return res.redirect('/access-denied');
    }

    let dashboardRole = 'member';
    if (isOwner) dashboardRole = 'owner';
    else if (bestAdmin) dashboardRole = bestAdmin.role;

    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
      globalName: discordUser.global_name,
      discriminator: discordUser.discriminator,
      guilds,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      dashboardRole,
      isOwner,
    };

    req.session.save(() => {
      res.redirect('/home');
    });
  } catch (err) {
    const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
    console.error('[Auth Error]', detail);
    res.redirect('/?error=auth_failed');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

router.get('/me', (req, res) => {
  if (req.session.user) {
    // لا نرسل توكنات OAuth إلى المتصفح أبداً — محفوظة في الجلسة على الخادم فقط.
    // إرسالها يجعل أي ثغرة XSS تسرق صلاحية ديسكورد كاملة للمستخدم.
    const { accessToken, refreshToken, ...safeUser } = req.session.user;
    res.json({ user: safeUser });
  } else {
    res.json({ user: null });
  }
});

router.post('/refresh-guilds', async (req, res) => {
  if (!req.session.user?.refreshToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const tokenData = await refreshToken(req.session.user.refreshToken);
    const guilds = await getUserGuilds(tokenData.access_token);
    req.session.user.guilds = guilds;
    req.session.user.accessToken = tokenData.access_token;
    req.session.user.refreshToken = tokenData.refresh_token;
    res.json({ guilds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh guilds' });
  }
});

export default router;
