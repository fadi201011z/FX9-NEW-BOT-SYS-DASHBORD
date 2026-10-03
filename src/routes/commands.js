import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { getAllCommandConfigs, setCommandConfig, logActivity } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import { getBotGuilds, getGuildRoles } from '../auth/discord.js';
import config from '../config.js';
import { resolveGuild } from '../services/guildResolver.js';
import { botPost } from '../services/botApi.js';
import { getCommandCatalog } from '../services/commandCatalog.js';

const router = Router();

/* ─── Public commands page ─────────────────────────────────────────────────
   Replica of novax.gg/ar/commands: same heading, same tab row, same search,
   same one-accordion-per-command list — with this bot's commands in it.

   layout:false is load-bearing, not decoration. This view is a whole document
   with its own head, and express-ejs-layouts would otherwise nest it inside the
   dashboard chrome — a second <html> inside the first, plus the dashboard
   sidebar, navbar, /css/style.css and the websocket bundle. It renders, and it
   looks wrong: the sidebar takes a fixed share of the width, so every box comes
   out narrower than the source's and the page scrolls sideways. The landing
   route opts out for the same reason. */
router.get('/', async (req, res) => {
  const { commands, categories, source } = await getCommandCatalog();
  res.render('commands', {
    layout: false,
    user: req.session?.user || null,
    page: 'commands',
    commands,
    categories,
    source,
    title: 'الأوامر',
  });
});

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  const { guildId } = req.params;
  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

  const { commands } = await getCommandCatalog();

  const commandConfigs = await getAllCommandConfigs(guildId);
  const configMap = {};
  for (const cc of commandConfigs) configMap[cc.commandName] = cc;

  res.render('guild/commands', {
    user: req.session.user,
    guild,
    commands,
    configMap,
    title: 'إدارة الأوامر',
  });
});

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { command, enabled } = req.body;
    const isEnabled = enabled !== undefined ? Boolean(enabled) : true;

    const existing = (await getAllCommandConfigs(guildId)).find(c => c.commandName === command) || {};

    // Save to DB first regardless of bot status
    setCommandConfig(guildId, command, {
      enabled: isEnabled,
      allowedRoles: existing.allowedRoles || [],
      blockedRoles: existing.blockedRoles || [],
    });

    logActivity(req.session.user.id, guildId, 'update_command', command,
      isEnabled ? 'تفعيل أمر' : 'تعطيل أمر', req.ip, req.sessionID);

    // Try to sync with bot (non-blocking)
    try {
      await botPost(`${config.botApiUrl}/api/sync-command`, {
        guildId, commandName: command, enabled: isEnabled,
        allowedRoles: existing.allowedRoles || [],
        blockedRoles: existing.blockedRoles || [],
      }, { timeout: 5000 });
    } catch (e) {
      console.error('[Commands] Bot sync skipped:', e.code || e.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:guildId/update-description', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const { command, description } = req.body;
    if (!command || description === undefined) {
      return res.status(400).json({ error: 'Missing command or description' });
    }

    const existing = (await getAllCommandConfigs(guildId)).find(c => c.commandName === command) || {};
    setCommandConfig(guildId, command, {
      enabled: existing.enabled ?? true,
      allowedRoles: existing.allowedRoles || [],
      customDescription: description,
    });

    logActivity(req.session.user.id, guildId, 'update_command_desc', command,
      'تعديل وصف الأمر', req.ip, req.sessionID);

    // Sync with bot
    try {
      await botPost(`${config.botApiUrl}/api/sync-command`, {
        guildId, commandName: command,
        enabled: existing.enabled ?? true,
        allowedRoles: existing.allowedRoles || [],
        customDescription: description,
      });
    } catch (e) {
      console.error('[Commands] Bot desc sync failed:', e.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:guildId/roles', isAuthenticated, hasGuildAccess, async (req, res) => {
  try {
    const botToken = config.discord.botToken;
    if (!botToken) return res.json([]);
    const roles = await getGuildRoles(req.params.guildId, botToken);
    res.json(roles.sort((a, b) => b.position - a.position));
  } catch {
    res.json([]);
  }
});

router.post('/:guildId/permissions', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const { command, allowedRoles, blockedRoles } = req.body;
    if (!command) return res.status(400).json({ error: 'Missing command' });

    const existing = (await getAllCommandConfigs(guildId)).find(c => c.commandName === command) || {};
    const ar = allowedRoles || [];
    const br = blockedRoles || [];

    // Save to local DB
    setCommandConfig(guildId, command, {
      enabled: existing.enabled ?? true,
      allowedRoles: ar,
      blockedRoles: br,
    });

    logActivity(req.session.user.id, guildId, 'update_command_perms', command,
      'تحديث صلاحيات الأمر', req.ip, req.sessionID);

    // Try to sync with bot (non-blocking)
    try {
      await botPost(`${config.botApiUrl}/api/sync-command`, {
        guildId, commandName: command, enabled: existing.enabled ?? true,
        allowedRoles: ar, blockedRoles: br,
      }, { timeout: 5000 });
    } catch (e) {
      console.error('[Commands] Bot perms sync skipped:', e.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
