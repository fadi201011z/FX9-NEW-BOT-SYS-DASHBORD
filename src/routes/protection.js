import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { logActivity, getGuildConfig, setGuildConfig, getAllGuildConfig } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildChannels, getGuildRoles } from '../auth/discord.js';
import config from '../config.js';
import { resolveGuild } from '../services/guildResolver.js';
import { botFetch } from '../services/botApi.js';

const router = Router();

// ─── Schema ────────────────────────────────────────────────────────────────
// One place decides what the page may write, and how. It mirrors the keys the
// bot reads in utils/protection.js, so a saved toggle is a running system and
// not just a stored string.

const BOOL_KEYS = ['anti_spam', 'anti_link', 'anti_mention', 'anti_nuke', 'anti_raid'];

// key -> [min, max, default]
const INT_KEYS = {
  spam_limit:            [2, 50, 5],
  spam_window:           [1000, 60000, 5000],
  spam_timeout_seconds:  [1, 86400, 60],
  mention_limit:         [1, 100, 5],
  nuke_channel_limit:    [2, 25, 3],
  nuke_role_limit:       [2, 25, 3],
  nuke_ban_limit:        [2, 50, 5],
  nuke_window:           [2000, 300000, 10000],
  raid_limit:            [3, 100, 10],
  raid_window:           [2000, 120000, 10000],
  raid_min_account_age:  [0, 365, 0],
};

const ENUM_KEYS = {
  spam_punishment: ['timeout', 'kick', 'ban', 'warn'],
  mention_action:  ['delete', 'timeout', 'kick', 'ban'],
  link_action:     ['delete', 'timeout', 'kick', 'ban'],
  nuke_action:     ['strip', 'kick', 'ban', 'timeout'],
  raid_action:     ['alert', 'kick', 'ban'],
};

const TEXT_KEYS = ['link_whitelist'];
const ARRAY_KEYS = ['protection_whitelist_roles', 'protection_whitelist_users', 'protection_whitelist_channels'];

function readProtection(all) {
  const get = (key, def) => {
    const v = all[key];
    return v === undefined || v === null ? def : v;
  };
  const out = {};
  for (const k of BOOL_KEYS) out[k] = get(k, 'true');
  for (const [k, spec] of Object.entries(INT_KEYS)) out[k] = get(k, String(spec[2]));
  for (const [k, allowed] of Object.entries(ENUM_KEYS)) out[k] = get(k, allowed[0]);
  for (const k of TEXT_KEYS) out[k] = get(k, '');
  return out;
}

function readArray(all, key) {
  try {
    const parsed = JSON.parse(all[key] ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  const { guildId } = req.params;
  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });

  const allGuildConfig = await getAllGuildConfig(guildId);
  const protection = readProtection(allGuildConfig);

  const restrictedChannels = readArray(allGuildConfig, 'restricted_channels');
  const whitelistRoles = readArray(allGuildConfig, 'protection_whitelist_roles');
  const whitelistUsers = readArray(allGuildConfig, 'protection_whitelist_users');
  const whitelistChannels = readArray(allGuildConfig, 'protection_whitelist_channels');

  // Channel + role lists for the dropdowns. Both are best-effort: a failed
  // Discord call degrades to an empty list rather than a broken page.
  let guildChannels = [];
  let guildRoles = [];
  try {
    const channels = await getGuildChannels(guildId, config.discord.botToken);
    guildChannels = (channels || [])
      .filter((c) => c.type === 0 || c.type === 5)
      .map((c) => ({ id: c.id, name: c.name }));
  } catch { /* dropdown stays empty */ }
  try {
    const roles = await getGuildRoles(guildId, config.discord.botToken);
    guildRoles = (roles || [])
      .filter((r) => r.name !== '@everyone' && !r.managed)
      .map((r) => ({ id: r.id, name: r.name, color: r.color }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  } catch { /* dropdown stays empty */ }

  const channelName = (id) => guildChannels.find((c) => c.id === id)?.name || id;
  const roleName = (id) => guildRoles.find((r) => r.id === id)?.name || id;

  res.render('guild/protection', {
    user: req.session.user,
    guild,
    protection,
    restrictedChannels,
    whitelistRoles: whitelistRoles.map((id) => ({ id, name: roleName(id) })),
    whitelistUsers: whitelistUsers.map((id) => ({ id })),
    whitelistChannels: whitelistChannels.map((id) => ({ id, name: channelName(id) })),
    guildChannels,
    guildRoles,
    logChannelId: (await getGuildConfig(guildId, 'log_channel'))?.value || '',
    modLogChannelId: (await getGuildConfig(guildId, 'modlog_channel'))?.value || '',
    title: 'إعدادات الحماية',
  });
});

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const body = req.body || {};
    const saved = {};

    for (const k of BOOL_KEYS) {
      const on = body[k] === true || body[k] === 'true' || body[k] === 'on' || body[k] === 1;
      saved[k] = on ? 'true' : 'false';
    }
    for (const [k, spec] of Object.entries(INT_KEYS)) {
      const [min, max, def] = spec;
      let n = parseInt(body[k], 10);
      if (!Number.isFinite(n)) n = def;
      saved[k] = String(Math.min(max, Math.max(min, n)));
    }
    for (const [k, allowed] of Object.entries(ENUM_KEYS)) {
      saved[k] = allowed.includes(body[k]) ? body[k] : allowed[0];
    }
    for (const k of TEXT_KEYS) {
      saved[k] = String(body[k] ?? '').replace(/[^a-zA-Z0-9.\-,\s]/g, '').slice(0, 600);
    }
    for (const k of ARRAY_KEYS) {
      const arr = Array.isArray(body[k]) ? body[k] : [];
      const clean = [...new Set(arr.map((x) => String(x).slice(0, 32)).filter(Boolean))].slice(0, 100);
      saved[k] = JSON.stringify(clean);
    }

    for (const [key, value] of Object.entries(saved)) {
      await setGuildConfig(guildId, key, value);
    }

    // Push the new cache to the bot so changes apply immediately (its own
    // 10s reload is the safety net if this call is missed).
    try {
      await botFetch(`${config.botApiUrl}/api/sync-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => {});
    } catch { /* bot offline — the periodic reload will catch up */ }

    logActivity(req.session.user.id, guildId, 'update_protection', null, 'تحديث إعدادات الحماية', req.ip, req.sessionID);
    res.json({ success: true, protection: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dry-run: asks the bot to check its own permissions and log-channel setup, and
// to mirror one sample alert. This is the "does it actually work?" button.
router.post('/:guildId/test', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const r = await botFetch(`${config.botApiUrl}/api/protection/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : 502).json(data);
  } catch (err) {
    res.status(502).json({ error: 'تعذّر الوصول إلى البوت. تأكد من أنه يعمل.', detail: err.message });
  }
});

router.post('/:guildId/restricted-channel/add', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { channelId, channelName } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId مطلوب' });

    const raw = await getGuildConfig(guildId, 'restricted_channels');
    let channels = [];
    try { channels = JSON.parse(raw?.value || '[]'); } catch {}

    if (channels.find((c) => c.id === channelId)) {
      return res.json({ success: true, message: 'الروم مضاف مسبقاً' });
    }

    channels.push({ id: channelId, name: channelName || channelId });
    await setGuildConfig(guildId, 'restricted_channels', JSON.stringify(channels));

    logActivity(req.session.user.id, guildId, 'add_restricted_channel', channelId, `إضافة روم محضور ${channelName}`, req.ip, req.sessionID);

    try {
      const botRes = await botFetch(`${config.botApiUrl}/api/restricted-channel-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId, channelId }),
        signal: AbortSignal.timeout(5000),
      });
      if (botRes.ok) return res.json({ success: true, message: 'تمت إضافة الروم المحضور وإرسال رسالة الشرح.' });
    } catch {}

    res.json({ success: true, message: 'تمت إضافة الروم المحضور.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/restricted-channel/remove', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId مطلوب' });

    const raw = await getGuildConfig(guildId, 'restricted_channels');
    let channels = [];
    try { channels = JSON.parse(raw?.value || '[]'); } catch {}

    const filtered = channels.filter((c) => c.id !== channelId);
    await setGuildConfig(guildId, 'restricted_channels', JSON.stringify(filtered));

    logActivity(req.session.user.id, guildId, 'remove_restricted_channel', channelId, 'إزالة روم محضور', req.ip, req.sessionID);
    res.json({ success: true, message: 'تمت إزالة الروم المحضور.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
