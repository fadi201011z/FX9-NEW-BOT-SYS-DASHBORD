import { Router } from 'express';
import { upsertUser, getUserAdminGuilds } from '../database.js';
import { getAuthUrl, exchangeCode, getUserInfo, getUserGuilds, refreshToken } from '../auth/discord.js';
import config from '../config.js';

const router = Router();

router.get('/discord', (req, res) => {
  res.redirect(getAuthUrl());
});

router.get('/discord/callback', async (req, res) => {
  try {
    const { code, error: discordError } = req.query;
    if (discordError) return res.redirect(`/?error=${discordError}`);
    if (!code) return res.redirect('/?error=no_code');

    const tokenData = await exchangeCode(code);
    const discordUser = await getUserInfo(tokenData.access_token);

    let guilds = [];
    try {
      guilds = await getUserGuilds(tokenData.access_token);
    } catch {}

    upsertUser(discordUser.id, discordUser.username, discordUser.avatar);

    const adminGuilds = getUserAdminGuilds(discordUser.id);
    const bestAdmin = adminGuilds.length > 0
      ? adminGuilds.reduce((a, b) => {
          const hierarchy = { owner: 4, manager: 3, admin: 2, moderator: 1, support: 0 };
          return (hierarchy[a.role] || 0) >= (hierarchy[b.role] || 0) ? a : b;
        })
      : null;

    const isOwner = discordUser.id === config.discord.ownerId;
    const hasManageGuild = guilds.some(g => (BigInt(g.permissions) & 0x20n) === 0x20n);
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
      res.redirect('/dashboard');
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
    res.json({ user: req.session.user });
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
