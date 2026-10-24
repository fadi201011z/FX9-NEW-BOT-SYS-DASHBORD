import express, { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole } from '../middleware/auth.js';
import { getGuildConfig, setGuildConfig, getAllGuildConfig, deleteGuildConfig, logAudit, logActivity } from '../database.js';
import { getTicketGuildConfig, saveTicketGuildConfig } from '../services/dataReader.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildChannels, getGuildRoles } from '../auth/discord.js';
import config from '../config.js';
import { resolveGuild } from '../services/guildResolver.js';
import { botFetch, botPost } from '../services/botApi.js';
import { CUSTOM_IMAGE_KEYS, SETTINGS_PAGES, buildSettingsLocals } from '../services/settingsPages.js';

const TICKET_KEY_MAP = {
  ticket_category: 'ticketCategoryId',
  admin_category: 'adminCategoryId',
  panel_channel: 'panelChannelId',
  log_channel_id: 'logChannelId',
};


// لكل عنصر مخصّص وضعٌ للعرض: صورة (افتراضي) أو إمبد. الوضع يُخزَّن تحت <mode>
// والإمبد (JSON) تحت <embed>. البوت يقرأ نفس المفاتيح عبر utils/customDisplay.js.
const CUSTOM_ITEMS = {
  welcome_image: { type: 'welcome', mode: 'welcome_display', embed: 'welcome_embed' },
  ticket_panel_image: { type: 'ticket', mode: 'ticket_display', embed: 'ticket_embed' },
  voice_panel_image: { type: 'voice', mode: 'voice_display', embed: 'voice_embed' },
};
const CUSTOM_MODE_VALUES = ['image', 'embed'];

// ─── أقسام التذاكر الافتراضية ──────────────────────────────────────────────
// المرآة الحرفية لأقسام البوت المضمّنة في data/ticketTypes.js: نفس المعرّفات،
// ونفس الأسماء والأوصاف والحقول. تُعرض في المحرّر حين لا يكون للسيرفر أقسام
// محفوظة بعد، وحينها يظهر ما يفعله البوت فعلاً بدل صورة مخالفة للواقع. أول
// حفظ من اللوحة ينسخها إلى قاعدة البيانات فتصبح هذه هي المُلزِمة للبوت.
const DEFAULT_TICKET_SECTIONS = [
  {
    id: 'technical', emoji: '🛠️', label: 'Technical Support',
    description: 'Bugs, errors, anything broken', color: '#3b82f6', enabled: true, supportRoleIds: [],
    fields: [
      { id: 'title',       label: '📌 Summary',        placeholder: 'One line describing the problem',    style: 'short',     required: true,  maxLength: 100 },
      { id: 'device',      label: '🖥️ Platform',       placeholder: 'PC • Android • iOS',                  style: 'short',     required: true,  maxLength: 50 },
      { id: 'description', label: '📝 What happened?', placeholder: 'What broke, and when did it start?',  style: 'paragraph', required: true,  maxLength: 1000 },
      { id: 'steps_tried', label: '🧪 Already tried',  placeholder: 'What have you done to fix it?',       style: 'paragraph', required: false, maxLength: 500 },
      { id: 'evidence',    label: '🔗 Evidence',       placeholder: 'Screenshot or video link',            style: 'short',     required: false, maxLength: 500 },
    ],
  },
  {
    id: 'complaint', emoji: '🚫', label: 'Report',
    description: 'Report a member or a problem', color: '#ef4444', enabled: true, supportRoleIds: [],
    fields: [
      { id: 'title',       label: '📌 Summary',        placeholder: 'e.g. Harassment in general chat',  style: 'short',     required: true,  maxLength: 100 },
      { id: 'target',      label: '👤 Member involved', placeholder: 'Name or user ID',                 style: 'short',     required: true,  maxLength: 50 },
      { id: 'description', label: '📝 What happened?', placeholder: 'Describe what occurred, in order', style: 'paragraph', required: true,  maxLength: 1000 },
      { id: 'evidence',    label: '🔗 Evidence',       placeholder: 'Screenshot or recording link',     style: 'short',     required: false, maxLength: 500 },
    ],
  },
  {
    id: 'partnership', emoji: '🤝', label: 'Partnership',
    description: 'Sponsorships and collaborations', color: '#22c55e', enabled: true, supportRoleIds: [],
    fields: [
      { id: 'title',       label: '🤝 Collaboration type', placeholder: 'Sponsorship • Events • Partnership', style: 'short',     required: true,  maxLength: 100 },
      { id: 'link',        label: '🔗 Server or channel',  placeholder: 'https://discord.gg/…',              style: 'short',     required: true,  maxLength: 200 },
      { id: 'description', label: '📝 Your offer',         placeholder: 'Audience, role, and terms',         style: 'paragraph', required: true,  maxLength: 1000 },
      { id: 'evidence',    label: '🔗 Extra links',        placeholder: 'Any supporting links',              style: 'short',     required: false, maxLength: 500 },
    ],
  },
  {
    id: 'other', emoji: '❓', label: 'Other',
    description: 'Anything that does not fit above', color: '#fbbf24', enabled: true, supportRoleIds: [],
    fields: [
      { id: 'title',       label: '📌 Summary',   placeholder: 'One line describing your request', style: 'short',     required: true,  maxLength: 100 },
      { id: 'description', label: '📝 Details',   placeholder: 'What do you need?',                style: 'paragraph', required: true,  maxLength: 1000 },
      { id: 'evidence',    label: '🔗 Evidence',  placeholder: 'Any helpful links (optional)',     style: 'short',     required: false, maxLength: 500 },
    ],
  },
];

// ─── قيود ديسكورد على الأقسام ──────────────────────────────────────────────
// تُطبَّق في الخادم لا في المتصفح فقط: قائمة الاختيار تقبل 25 خياراً، والنموذج
// يقبل 5 حقول، وتسمية الحقل 45 حرفاً. تجاوزها يعني أن يرفض ديسكورد البنل كاملاً
// لحظة وصوله، لذلك تُقصّ هنا بدل أن تُقبل ثم تفشل لاحقاً.
const SECTION_LIMITS = { sections: 25, fields: 5, label: 100, desc: 100, fieldLabel: 45, placeholder: 100, maxLength: 1024 };

/** lowercase-ascii/arabic slug — يطابق ما يفعله البوت عند إعادة تسمية تذكرة. */
function sectionSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u0600-\u06ff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

/**
 * Cleans the editor's payload into exactly what the bot will read: everything
 * clamped to Discord's limits, ids made unique and slug-shaped, and disabled
 * garbage dropped rather than stored.
 */
function sanitizeSections(input) {
  if (!Array.isArray(input)) return [];
  const L = SECTION_LIMITS;
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const clamp = (v, min, max, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
  };
  const hex = (v) => {
    const t = text(v, 9);
    return /^#[0-9a-f]{6}$/i.test(t) ? t.toLowerCase() : '';
  };

  const seenIds = new Set();
  const out = [];

  for (const raw of input.slice(0, L.sections)) {
    if (!raw || typeof raw !== 'object') continue;

    let id = sectionSlug(raw.id || raw.label) || 'section';
    while (seenIds.has(id)) id = `${id.slice(0, L.sections > 9 ? 28 : 30)}-${out.length + 1}`;
    seenIds.add(id);

    // Modal inputs must carry unique custom ids, or Discord rejects the modal.
    const seenFields = new Set();
    const fields = (Array.isArray(raw.fields) ? raw.fields : [])
      .slice(0, L.fields)
      .map((f, i) => {
        let fid = (typeof f?.id === 'string' && /^[a-z0-9_]{1,32}$/.test(f.id)) ? f.id : `field_${i + 1}`;
        while (seenFields.has(fid)) fid = `${fid}_${i + 1}`.slice(0, 32);
        seenFields.add(fid);
        return {
          id: fid,
          label: text(f?.label, L.fieldLabel),
          placeholder: text(f?.placeholder, L.placeholder),
          style: f?.style === 'paragraph' ? 'paragraph' : 'short',
          required: !!f?.required,
          maxLength: clamp(f?.maxLength, 1, L.maxLength, 500),
        };
      })
      .filter((f) => f.label);

    out.push({
      id,
      emoji: text(raw.emoji, 32) || '🎫',
      label: text(raw.label, L.label) || id,
      description: text(raw.description, L.desc),
      color: hex(raw.color),
      enabled: raw.enabled !== false,
      supportRoleIds: (Array.isArray(raw.supportRoleIds) ? raw.supportRoleIds : [])
        .map((r) => String(r))
        .filter((r) => /^\d{17,20}$/.test(r))
        .slice(0, 20),
      fields,
    });
  }

  return out;
}

/**
 * يحوّل قائمة رتب من الطلب إلى معرّفات Snowflake فريدة، بحد أقصى عشر رتب.
 * نتحقق هنا لا في الواجهة فقط: الطلب يمكن أن يصل من خارج الصفحة.
 */
function sanitizeRoleList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  const ids = raw.map((v) => String(v).trim()).filter((v) => /^\d{17,20}$/.test(v));
  return [...new Set(ids)].slice(0, 10);
}

const router = Router();

async function fetchGuildChannels(guildId) {
  try {
    const res = await botFetch(`${config.botApiUrl}/api/guilds/${guildId}/channels`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  try {
    return await getGuildChannels(guildId, config.discord.botToken);
  } catch {}
  return [];
}

async function fetchGuildRoles(guildId) {
  try {
    const res = await botFetch(`${config.botApiUrl}/api/guilds/${guildId}/roles`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  try {
    return await getGuildRoles(guildId, config.discord.botToken);
  } catch {}
  return [];
}

async function buildViewData(guildId) {
  const cfg = await getAllGuildConfig(guildId);
  const ticketJson = await getTicketGuildConfig(guildId);
  if (ticketJson) {
    cfg.ticket_category = ticketJson.ticketCategoryId || (cfg.ticket_category || '');
    cfg.admin_category = ticketJson.adminCategoryId || (cfg.admin_category || '');
    cfg.panel_channel = ticketJson.panelChannelId || (cfg.panel_channel || '');
    cfg.log_channel_id = ticketJson.logChannelId || (cfg.log_channel_id || '');
    cfg.support_role = ticketJson.supportRoleIds.length ? ticketJson.supportRoleIds.join(', ') : (cfg.support_role || '');
    cfg.ticket_counter = ticketJson.ticketCounter || cfg.ticket_counter || 0;
  }

  // أقسام التذاكر: المحفوظة إن وُجدت، وإلا الافتراضية المضمّنة — حتى يرى المدير
  // دائماً ما يعمل به البوت فعلاً لا محرّراً فارغاً.
  const ticketSections = (Array.isArray(ticketJson?.sections) && ticketJson.sections.length)
    ? ticketJson.sections
    : DEFAULT_TICKET_SECTIONS;

  let supportRoleArray = [];
  if (cfg.support_role) {
    supportRoleArray = String(cfg.support_role).split(',').map(s => s.trim()).filter(Boolean);
  }

  const channels = { text: [], voice: [], category: [] };
  const allChannels = await fetchGuildChannels(guildId);
  for (const c of allChannels) {
    if (c.type === 0 || c.type === 5) channels.text.push({ id: c.id, name: c.name });
    else if (c.type === 2) channels.voice.push({ id: c.id, name: c.name });
    else if (c.type === 4) channels.category.push({ id: c.id, name: c.name });
  }

  let roles = await fetchGuildRoles(guildId);
  roles.sort((a, b) => (b.position || 0) - (a.position || 0));

  return { config: cfg, supportRoleArray, channels, roles, ticketSections };
}

async function syncConfigToBot() {
  try {
    const res = await botFetch(`${config.botApiUrl}/api/sync-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return true;
  } catch {}
  return false;
}

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  const { guildId } = req.params;
  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });
  const data = await buildViewData(guildId);

  res.render('guild/settings/general', {
    ...buildSettingsLocals(data, guild, req.session.user),
    user: req.session.user,
    guild,
    title: 'الإعدادات',
  });
});

router.post('/:guildId/save', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const settings = req.body.settings || req.body;
    let changed = 0;

    for (const [key, rawValue] of Object.entries(settings)) {
      if (key === 'ticket_counter' && (rawValue === '' || rawValue == null)) continue;
      const value = rawValue == null ? '' : String(rawValue).trim();
      const oldValue = (await getGuildConfig(guildId, key))?.value ?? null;

      if (key === 'support_role') {
        const ids = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
        saveTicketGuildConfig(guildId, { supportRoleIds: ids });
      } else if (TICKET_KEY_MAP[key]) {
        saveTicketGuildConfig(guildId, { [TICKET_KEY_MAP[key]]: value });
      } else if (key === 'ticket_counter') {
        saveTicketGuildConfig(guildId, { ticketCounter: Number(value) || 0 });
      }

      if (!value) {
        await deleteGuildConfig(guildId, key);
      } else {
        await setGuildConfig(guildId, key, value);
      }

      logAudit(req.session.user.id, guildId, 'update_setting', key, oldValue, value, req.ip, req.sessionID);
      logActivity(req.session.user.id, guildId, 'update_setting', key, `تعديل ${key}`, req.ip, req.sessionID);
      changed++;
    }

    const synced = await syncConfigToBot();

    res.json({ success: true, changed, synced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/sync', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const synced = await syncConfigToBot();
    res.json({
      success: synced,
      message: synced ? 'تمت المزامنة الفورية مع البوت.' : 'البوت غير متصل — ستُطبق الإعدادات تلقائياً خلال ثوانٍ.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });

    const oldValue = await getGuildConfig(guildId, key);
    setGuildConfig(guildId, key, value);

    if (key === 'support_role') {
      const ids = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
      saveTicketGuildConfig(guildId, { supportRoleIds: ids });
    } else if (TICKET_KEY_MAP[key]) {
      const jsonKey = TICKET_KEY_MAP[key];
      saveTicketGuildConfig(guildId, { [jsonKey]: value });
    }

    logAudit(req.session.user.id, guildId, 'update_setting', key, oldValue, value, req.ip, req.sessionID);
    logActivity(req.session.user.id, guildId, 'update_setting', key, `تعديل ${key}`, req.ip, req.sessionID);

    res.json({ success: true, key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/delete', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });

    const oldValue = await getGuildConfig(guildId, key);
    deleteGuildConfig(guildId, key);

    logAudit(req.session.user.id, guildId, 'delete_setting', key, oldValue, null, req.ip, req.sessionID);
    logActivity(req.session.user.id, guildId, 'delete_setting', key, `حذف ${key}`, req.ip, req.sessionID);

    res.json({ success: true, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auto-roles (general settings) ─────────────────────────────────────────
// قائمتان مستقلتان: واحدة للأشخاص وواحدة للبوتات. تُخزَّن حتى وهي فارغة —
// البوت يقرأ "" كـ«المدير أفرغ القائمة» والمفتاح الغائب كـ«لم يُضبط بعد»،
// وهذا ما يسمح له بالرجوع إلى `autorole_id` القديم عند عدم الضبط.
router.post('/:guildId/autoroles', isAuthenticated, hasGuildAccess, requireRole('admin'), sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const human = sanitizeRoleList(req.body.human);
    const bot = sanitizeRoleList(req.body.bot);
    const humanValue = human.join(',');
    const botValue = bot.join(',');

    const [oldHuman, oldBot] = await Promise.all([
      getGuildConfig(guildId, 'autorole_human'),
      getGuildConfig(guildId, 'autorole_bot'),
    ]);

    await Promise.all([
      setGuildConfig(guildId, 'autorole_human', humanValue),
      setGuildConfig(guildId, 'autorole_bot', botValue),
    ]);

    logAudit(req.session.user.id, guildId, 'update_setting', 'autorole_human', oldHuman?.value ?? null, humanValue, req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'update_setting', 'autorole_bot', oldBot?.value ?? null, botValue, req.ip, req.sessionID);
    logActivity(req.session.user.id, guildId, 'update_setting', 'الرتب التلقائية', `الأشخاص: ${human.length} / البوتات: ${bot.length}`, req.ip, req.sessionID);

    const synced = await syncConfigToBot();
    res.json({ success: true, synced, human, bot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:guildId/all', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const config = getAllGuildConfig(guildId);
  res.json({ config });
});

// ─── Custom images (welcome / ticket panel / voice panel) ──────────────────
// تُخزَّن الصور كرابط https فقط — أبداً base64 — حتى يبقى الإعداد صغيراً ولا
// تتحمّل اللوحة ولا البوت حجم الصورة. ملفات الرفع من المتصفح تُمرَّر إلى موقع
// صور عام (catbox.moe) ويُحفظ الرابط المُعاد فقط.
const IMAGE_HOST_API = 'https://catbox.moe/user/api.php';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB — سقف مرفقات ديسكورد حتى يبقى البنل قابلاً لإعادة الرفع

const IMAGE_TYPES = [
  { mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => b.length > 6 && b.slice(0, 3).toString('ascii') === 'GIF' },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
];

// يتعرّف على نوع الصورة من توقيع الملف (Magic bytes) لا من الاسم أو الترويسة.
function sniffImageType(buffer) {
  return IMAGE_TYPES.find((t) => t.test(buffer))?.mime || null;
}

// يرفع بايتات الصورة إلى الموقع الخارجي ويعيد الرابط المباشر.
async function uploadToImageHost(buffer, mime) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', new Blob([buffer], { type: mime }), 'image');
  const res = await fetch(IMAGE_HOST_API, {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': 'FX9-Dashboard/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`host HTTP ${res.status}`);
  const url = (await res.text()).trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(url.slice(0, 120) || 'empty response');
  return url;
}

// رفع ملف صورة من المتصفح: يتحقق من الحجم والصيغة، ثم يرفعه إلى الموقع ويعيد
// رابطاً مباشراً فقط. لا يُخزَّن أي شيء في قاعدة البيانات هنا (الحفظ عبر /images).
const rawImageBody = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });
router.post('/:guildId/images/upload', isAuthenticated, hasGuildAccess, requireRole('admin'), (req, res, next) => {
  rawImageBody(req, res, (err) => {
    if (err) {
      const tooLarge = err.type === 'entity.too.large' || err.status === 413;
      return res.status(413).json({ error: tooLarge ? 'حجم الصورة كبير جداً (الحد 8MB)' : 'تعذّر قراءة الملف' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || !buffer.length) return res.status(400).json({ error: 'لم يتم استلام أي ملف' });
    if (buffer.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'حجم الصورة كبير جداً (الحد 8MB)' });
    const mime = sniffImageType(buffer);
    if (!mime) return res.status(400).json({ error: 'صيغة غير مدعومة — المسموح: PNG / JPG / GIF / WEBP' });
    const url = await uploadToImageHost(buffer, mime);
    res.json({ success: true, url });
  } catch (err) {
    res.status(502).json({ error: `فشل رفع الصورة إلى الموقع: ${err.message}` });
  }
});

// يعيد قيم الصور المخصصة الثلاث (روابط) — تُستخدم للمعاينة في الواجهة.
// أي صورة قديمة مخزّنة base64 تُرحَّل تلقائياً إلى رابط (مرة واحدة لكل صورة).
const base64MigrationFailed = new Set();

async function migrateBase64Image(guildId, key, dataUri) {
  const guard = `${guildId}:${key}`;
  if (base64MigrationFailed.has(guard)) return null;
  const match = /^data:image\/[^;,]+;base64,(.+)$/s.exec(dataUri);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('size');
    const mime = sniffImageType(buffer);
    if (!mime) throw new Error('type');
    const url = await uploadToImageHost(buffer, mime);
    await setGuildConfig(guildId, key, url);
    syncConfigToBot().catch(() => {});
    return url;
  } catch {
    base64MigrationFailed.add(guard);
    return null;
  }
}

router.get('/:guildId/images', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const cfg = await getAllGuildConfig(guildId);
    const images = {};
    const modes = {};
    const embeds = {};
    for (const key of CUSTOM_IMAGE_KEYS) {
      let value = cfg[key] || '';
      if (/^data:image\//i.test(value)) {
        // ترحيل غير حاجب: تُعاد القيمة الحالية الآن، وتُحوَّل إلى رابط في الخلفية
        // لتظهر كرابط في التحميل التالي (مرة واحدة فقط لكل صورة في كل عملية).
        migrateBase64Image(guildId, key, value).catch(() => {});
      }
      images[key] = value;

      const item = CUSTOM_ITEMS[key];
      modes[key] = cfg[item.mode] === 'embed' ? 'embed' : 'image';
      embeds[key] = parseEmbed(cfg[item.embed]);
    }
    res.json({ success: true, images, modes, embeds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Parses a stored embed JSON string into a plain object (null when absent/invalid). */
function parseEmbed(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Cleans an embed coming from the browser to exactly what the bot expects.
 * Every value is clamped to Discord's limits and links are restricted to
 * http(s). Returns null when nothing meaningful is left, so the caller can
 * refuse to store an empty embed.
 */
function sanitizeEmbed(input) {
  if (!input || typeof input !== 'object') return null;
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const url = (value) => {
    const text2 = text(value, 2048);
    return /^https?:\/\//i.test(text2) ? text2 : '';
  };
  const color = (value) => {
    const text2 = text(value, 9);
    return /^#[0-9a-f]{6}$/i.test(text2) ? text2.toLowerCase() : '';
  };

  const fields = Array.isArray(input.fields)
    ? input.fields.slice(0, 25)
        .map((f) => ({ name: text(f?.name, 256), value: text(f?.value, 1024), inline: !!f?.inline }))
        .filter((f) => f.name || f.value)
    : [];

  const embed = {
    color: color(input.color) || '#d000ff',
    authorName: text(input.authorName, 256),
    authorIcon: url(input.authorIcon),
    title: text(input.title, 256),
    description: text(input.description, 4096),
    fields,
    image: url(input.image),
    thumbnail: url(input.thumbnail),
    footerText: text(input.footerText, 2048),
    footerIcon: url(input.footerIcon),
    timestamp: !!input.timestamp,
  };

  const empty = !embed.authorName && !embed.title && !embed.description
    && !embed.fields.length && !embed.image && !embed.thumbnail && !embed.footerText;
  return empty ? null : embed;
}

/** Persists one custom setting (set or delete), audits it, then syncs + refreshes the panels. */
async function persistCustomSetting(req, guildId, key, value) {
  const oldValue = (await getGuildConfig(guildId, key))?.value ?? null;
  if (value === null || value === '') await deleteGuildConfig(guildId, key);
  else await setGuildConfig(guildId, key, value);

  logAudit(req.session.user.id, guildId, 'update_setting', key, oldValue, value || null, req.ip, req.sessionID);
  logActivity(req.session.user.id, guildId, 'update_setting', key, value ? `تعديل ${key}` : `حذف ${key}`, req.ip, req.sessionID);

  const synced = await syncConfigToBot();

  let refreshed = false;
  try {
    const rf = await botFetch(`${config.botApiUrl}/api/panels/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId }),
      signal: AbortSignal.timeout(4000),
    });
    refreshed = rf.ok;
  } catch {}

  return { synced, refreshed };
}

// يحفظ وضع العرض (صورة/إمبد) لعنصر مخصّص ثم يزامن البوت ويحدّث البنلات فوراً.
router.post('/:guildId/images/mode', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const { key, mode } = req.body || {};
    const item = CUSTOM_ITEMS[key];
    if (!item) return res.status(400).json({ error: 'Invalid image key' });
    if (!CUSTOM_MODE_VALUES.includes(mode)) return res.status(400).json({ error: 'Invalid display mode' });

    // الوضع الافتراضي هو الصورة — نحذف المفتاح بدل تخزين 'image' لتقليل الضجيج.
    const result = await persistCustomSetting(req, guildId, item.mode, mode === 'embed' ? 'embed' : '');
    res.json({ success: true, key, mode, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// يحفظ تعريف الإمبد (JSON مُنقّى) لعنصر مخصّص، أو يحذفه عند التفريغ.
router.post('/:guildId/images/embed', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const { key, embed } = req.body || {};
    const item = CUSTOM_ITEMS[key];
    if (!item) return res.status(400).json({ error: 'Invalid image key' });

    const clean = embed == null ? null : sanitizeEmbed(embed);
    // إمبد فارغ/محذوف: نحذف المفتاح ليعود البوت إلى الصورة تلقائياً.
    const result = await persistCustomSetting(req, guildId, item.embed, clean ? JSON.stringify(clean) : '');
    res.json({ success: true, key, embed: clean, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// يحفظ صورة مخصصة كقيمة إعداد (رابط https مباشر فقط — لا base64)،
// ثم يزامن الإعداد مع البوت ويحدّث البنلات فوراً.
router.post('/:guildId/images', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const { key, value } = req.body;
    if (!CUSTOM_IMAGE_KEYS.includes(key)) {
      return res.status(400).json({ error: 'Invalid image key' });
    }

    const raw = value == null ? '' : String(value).trim();
    if (raw.length > 2048) {
      return res.status(400).json({ error: 'الرابط طويل جداً' });
    }
    // قبول قيمة فارغة (حذف) أو رابط http(s) مباشر فقط — الرفع يتم عبر /images/upload
    if (raw && !/^https?:\/\//i.test(raw)) {
      return res.status(400).json({ error: 'مسموح برابط صورة مباشر https:// فقط' });
    }

    const result = await persistCustomSetting(req, guildId, key, raw);
    res.json({ success: true, key, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// يمرّر الصور الافتراضية من البوت (تُستخدم في زر «عرض الصورة الحالية» عندما
// لا تكون هناك صورة مخصصة للسيرفر)
router.get('/:guildId/default-image/:type', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { type } = req.params;
    if (!['welcome', 'ticket', 'voice'].includes(type)) {
      return res.status(400).json({ error: 'Invalid image type' });
    }
    const br = await botFetch(`${config.botApiUrl}/api/default-images/${type}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!br.ok) return res.status(404).json({ error: 'Default image not found' });
    const buf = Buffer.from(await br.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch {
    res.status(502).json({ error: 'Bot unreachable' });
  }
});

// ─── Welcome avatar placement (used by the welcome-image editor) ────────────
// The dashboard's editor lets admins drop the joining member's avatar anywhere
// on the custom welcome image and pick its size / ring. Values are stored under
// dedicated keys that the bot reads when it renders the card.
const WELCOME_AVATAR_DEFAULTS = { x: 1340, y: 527, size: 512, ring: true, ringColor: '#ffffff', ringWidth: 5 };

function readWelcomeAvatar(cfg) {
  const num = (key, fallback) => {
    const raw = cfg[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  const color = cfg.welcome_avatar_ring_color;
  return {
    x: num('welcome_avatar_x', WELCOME_AVATAR_DEFAULTS.x),
    y: num('welcome_avatar_y', WELCOME_AVATAR_DEFAULTS.y),
    size: num('welcome_avatar_size', WELCOME_AVATAR_DEFAULTS.size),
    ring: cfg.welcome_avatar_ring === undefined ? true : String(cfg.welcome_avatar_ring) === '1',
    ringColor: /^#[0-9a-f]{6}$/i.test(color || '') ? color : WELCOME_AVATAR_DEFAULTS.ringColor,
    ringWidth: num('welcome_avatar_ring_width', WELCOME_AVATAR_DEFAULTS.ringWidth),
  };
}

router.get('/:guildId/welcome-avatar', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const cfg = await getAllGuildConfig(req.params.guildId);
    res.json({ success: true, avatar: readWelcomeAvatar(cfg) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/welcome-avatar', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const b = req.body || {};
    const clamp = (v, min, max, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };

    const avatar = {
      x: clamp(b.x, 0, 1920, WELCOME_AVATAR_DEFAULTS.x),
      y: clamp(b.y, 0, 1080, WELCOME_AVATAR_DEFAULTS.y),
      size: clamp(b.size, 40, 1080, WELCOME_AVATAR_DEFAULTS.size),
      ring: b.ring !== false && b.ring !== '0',
      ringColor: /^#[0-9a-f]{6}$/i.test(String(b.ringColor || '')) ? String(b.ringColor).toLowerCase() : WELCOME_AVATAR_DEFAULTS.ringColor,
      ringWidth: clamp(b.ringWidth, 0, 40, WELCOME_AVATAR_DEFAULTS.ringWidth),
    };

    const pairs = {
      welcome_avatar_x: String(avatar.x),
      welcome_avatar_y: String(avatar.y),
      welcome_avatar_size: String(avatar.size),
      welcome_avatar_ring: avatar.ring ? '1' : '0',
      welcome_avatar_ring_color: avatar.ringColor,
      welcome_avatar_ring_width: String(avatar.ringWidth),
    };
    for (const [key, value] of Object.entries(pairs)) {
      await setGuildConfig(guildId, key, value);
    }

    logAudit(req.session.user.id, guildId, 'update_setting', 'welcome_avatar', null, JSON.stringify(avatar), req.ip, req.sessionID);
    logActivity(req.session.user.id, guildId, 'update_setting', 'welcome_avatar', 'تعديل موضع صورة الترحيب', req.ip, req.sessionID);

    const synced = await syncConfigToBot();
    res.json({ success: true, synced, avatar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── أقسام التذاكر القابلة للتخصيص ────────────────────────────────────────
// تُخزَّن في وثيقة TicketGuildConfig (نفس الوثيقة التي يقرأ منها البوت)، لا في
// جدول الإعدادات المفتاح/القيمة — لأنها بنية لا قيمة مفردة. المساران يعيدان
// الأقسام دائماً بالشكل النهائي حتى يتزامن المحرّر مع ما ستقرأه البوت فعلاً.
router.get('/:guildId/ticket-sections', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const ticketJson = await getTicketGuildConfig(req.params.guildId);
    const saved = Array.isArray(ticketJson?.sections) && ticketJson.sections.length;
    res.json({
      success: true,
      isCustom: !!saved,
      sections: saved ? ticketJson.sections : DEFAULT_TICKET_SECTIONS,
      defaults: DEFAULT_TICKET_SECTIONS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/ticket-sections', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const sections = sanitizeSections(req.body?.sections);

    const before = await getTicketGuildConfig(guildId);
    const oldValue = JSON.stringify(before?.sections || []);

    await saveTicketGuildConfig(guildId, { sections });

    logAudit(req.session.user.id, guildId, 'update_setting', 'ticket_sections', oldValue, JSON.stringify(sections), req.ip, req.sessionID);
    logActivity(req.session.user.id, guildId, 'update_setting', 'ticket_sections', `تعديل أقسام التذاكر (${sections.length} أقسام)`, req.ip, req.sessionID);

    const synced = await syncConfigToBot();

    let refreshed = false;
    try {
      const rf = await botFetch(`${config.botApiUrl}/api/panels/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId }),
        signal: AbortSignal.timeout(4000),
      });
      refreshed = rf.ok;
    } catch {}

    res.json({ success: true, sections, synced, refreshed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── صفحة إعدادات واحدة من مركز الإعدادات (general/welcome/logs/...) ───────
// تُعرَّف أخيراً لتأتي بعد كل المسارات الثابتة مثل /all و /images.
router.get('/:guildId/:page', isAuthenticated, hasGuildAccess, requireRole('admin'), async (req, res) => {
  const { guildId, page } = req.params;
  const def = SETTINGS_PAGES[page];
  if (!def) return res.redirect(`/settings/${guildId}`);

  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });
  const data = await buildViewData(guildId);

  res.render(def.view, {
    ...buildSettingsLocals(data, guild, req.session.user),
    user: req.session.user,
    guild,
    settingsPage: page,
    title: def.title,
  });
});

export default router;