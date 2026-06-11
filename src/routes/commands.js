import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, canModify } from '../middleware/auth.js';
import { getAllCommandConfigs, setCommandConfig, logActivity } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import { getBotGuilds, getGuildRoles } from '../auth/discord.js';
import config from '../config.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_COMMANDS_DIR = path.join(__dirname, '..', '..', '..', 'NEW SYS BOT', 'src', 'commands');

const router = Router();

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);

  let commands = [];
  try {
    const dirs = fs.readdirSync(BOT_COMMANDS_DIR);
    for (const dir of dirs) {
      const dirPath = path.join(BOT_COMMANDS_DIR, dir);
      if (fs.statSync(dirPath).isDirectory()) {
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const nameMatch = content.match(/\.setName\(['"](.+?)['"]\)/);
          const descMatch = content.match(/\.setDescription\(['"](.+?)['"]\)/);
          if (nameMatch) {
            commands.push({
              name: nameMatch[1],
              description: descMatch ? descMatch[1] : '',
              category: dir,
              file: file,
            });
          }
        }
      }
    }
  } catch {}

  const commandConfigs = getAllCommandConfigs(guildId);
  const configMap = {};
  for (const cc of commandConfigs) configMap[cc.command_name] = cc;

  res.render('guild/commands', {
    user: req.session.user,
    guild,
    commands,
    configMap,
    title: 'إدارة الأوامر',
  });
});

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, canModify, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { command, enabled } = req.body;
    const isEnabled = enabled !== undefined ? Boolean(enabled) : true;

    const existing = getAllCommandConfigs(guildId).find(c => c.command_name === command) || {};

    // Send to bot's in-memory state via API (single source of truth)
    let botOk = false;
    try {
      const botRes = await axios.post(`http://localhost:10001/api/sync-command`, {
        guildId, commandName: command, enabled: isEnabled,
        allowedRoles: existing.allowed_roles ? JSON.parse(existing.allowed_roles) : [],
        blockedRoles: existing.blocked_roles ? JSON.parse(existing.blocked_roles) : [],
      }, { timeout: 5000 });
      botOk = botRes.data && botRes.data.synced;
    } catch (e) {
      console.error('[Commands] Bot sync FAILED:', e.code || e.message);
      return res.status(502).json({ error: 'فشل الاتصال بالبوت', detail: e.message, code: e.code });
    }

    if (!botOk) {
      return res.status(502).json({ error: 'البوت لم يؤكد التحديث' });
    }

    // Write to local DB for dashboard display (only after bot confirms)
    setCommandConfig(guildId, command, {
      enabled: isEnabled ? 1 : 0,
      allowedRoles: existing.allowed_roles ? JSON.parse(existing.allowed_roles) : [],
      blockedRoles: existing.blocked_roles ? JSON.parse(existing.blocked_roles) : [],
      allowedChannels: existing.allowed_channels ? JSON.parse(existing.allowed_channels) : [],
      blockedChannels: existing.blocked_channels ? JSON.parse(existing.blocked_channels) : [],
    });

    logActivity(req.session.user.id, guildId, 'update_command', command,
      isEnabled ? 'تفعيل أمر' : 'تعطيل أمر', req.ip, req.sessionID);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:guildId/update-description', isAuthenticated, hasGuildAccess, canModify, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { command, description } = req.body;
    if (!command || description === undefined) {
      return res.status(400).json({ error: 'Missing command or description' });
    }

    const existing = getAllCommandConfigs(guildId).find(c => c.command_name === command) || {};
    setCommandConfig(guildId, command, {
      enabled: existing.enabled ?? 1,
      allowedRoles: existing.allowed_roles ? JSON.parse(existing.allowed_roles) : [],
      allowedChannels: existing.allowed_channels ? JSON.parse(existing.allowed_channels) : [],
      blockedChannels: existing.blocked_channels ? JSON.parse(existing.blocked_channels) : [],
      customDescription: description,
    });

    logActivity(req.session.user.id, guildId, 'update_command_desc', command,
      'تعديل وصف الأمر', req.ip, req.sessionID);

    // Sync with bot
    try {
      await axios.post(`http://localhost:10001/api/sync-command`, {
        guildId, commandName: command,
        enabled: existing.enabled ?? 1,
        allowedRoles: existing.allowed_roles ? JSON.parse(existing.allowed_roles) : [],
        allowedChannels: existing.allowed_channels ? JSON.parse(existing.allowed_channels) : [],
        blockedChannels: existing.blocked_channels ? JSON.parse(existing.blocked_channels) : [],
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

router.post('/:guildId/permissions', isAuthenticated, hasGuildAccess, canModify, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { command, allowedRoles, blockedRoles } = req.body;
    if (!command) return res.status(400).json({ error: 'Missing command' });

    const existing = getAllCommandConfigs(guildId).find(c => c.command_name === command) || {};
    const ar = allowedRoles || [];
    const br = blockedRoles || [];

    // Save to local DB
    setCommandConfig(guildId, command, {
      enabled: existing.enabled ?? 1,
      allowedRoles: ar,
      blockedRoles: br,
      allowedChannels: existing.allowed_channels ? JSON.parse(existing.allowed_channels) : [],
      blockedChannels: existing.blocked_channels ? JSON.parse(existing.blocked_channels) : [],
    });

    logActivity(req.session.user.id, guildId, 'update_command_perms', command,
      'تحديث صلاحيات الأمر', req.ip, req.sessionID);

    // Sync with bot
    let botOk = false;
    try {
      const botRes = await axios.post(`http://localhost:10001/api/sync-command`, {
        guildId, commandName: command, enabled: existing.enabled ?? 1,
        allowedRoles: ar, blockedRoles: br,
      }, { timeout: 5000 });
      botOk = botRes.data && botRes.data.synced;
    } catch (e) {
      return res.status(502).json({ error: 'فشل الاتصال بالبوت', detail: e.message });
    }
    if (!botOk) return res.status(502).json({ error: 'البوت لم يؤكد التحديث' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
