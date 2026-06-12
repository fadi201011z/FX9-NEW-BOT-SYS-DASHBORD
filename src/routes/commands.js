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

const FALLBACK_COMMANDS = [
  {category:"info",name:"ping",description:"فحص زمن استجابة البوت والاتصال",file:"ping.js"},
  {category:"info",name:"help",description:"عرض جميع الأوامر المتاحة مع شرحها",file:"help.js"},
  {category:"info",name:"sysinfo",description:"معلومات تفصيلية عن البوت والإحصائيات",file:"botinfo.js"},
  {category:"info",name:"userinfo",description:"معلومات تفصيلية عن عضو في السيرفر",file:"userinfo.js"},
  {category:"info",name:"serverinfo",description:"معلومات تفصيلية عن السيرفر الحالي",file:"serverinfo.js"},
  {category:"info",name:"config",description:"عرض إعدادات البوت الحالية لهذا السيرفر",file:"config.js"},
  {category:"members",name:"rules",description:"عرض قوانين السيرفر",file:"serverrules.js"},
  {category:"members",name:"rank",description:"عرض ترتيبك في السيرفر حسب تاريخ الانضمام",file:"rank.js"},
  {category:"members",name:"profile",description:"عرض ملف عضو بشكل احترافي",file:"profile.js"},
  {category:"members",name:"avatar",description:"عرض صورة عضو بأعلى دقة ممكنة",file:"avatar.js"},
  {category:"moderation",name:"warn",description:"نظام التحذيرات — إضافة أو عرض أو مسح تحذيرات الأعضاء",file:"warn.js"},
  {category:"moderation",name:"unlock",description:"فتح قناة مغلقة والسماح للأعضاء بالإرسال فيها",file:"unlock.js"},
  {category:"moderation",name:"unhide",description:"إظهار قناة مخفية للأعضاء العاديين",file:"unhide.js"},
  {category:"moderation",name:"timeout",description:"إيقاف عضو مؤقتاً لمدة محددة (كتم)",file:"timeout.js"},
  {category:"moderation",name:"slowmode",description:"ضبط وضع البطء في القناة الحالية",file:"slowmode.js"},
  {category:"moderation",name:"role",description:"إضافة أو إزالة رتبة من عضو في السيرفر",file:"role.js"},
  {category:"moderation",name:"nick",description:"تغيير أو إعادة ضبط لقب عضو",file:"nick.js"},
  {category:"moderation",name:"lock",description:"إغلاق قناة ومنع الأعضاء من الإرسال فيها",file:"lock.js"},
  {category:"moderation",name:"kick",description:"طرد عضو من السيرفر مع إرسال إشعار له",file:"kick.js"},
  {category:"moderation",name:"hide",description:"إخفاء قناة عن الأعضاء العاديين",file:"hide.js"},
  {category:"moderation",name:"clear",description:"مسح رسائل بشكل جماعي مع فلاتر اختيارية",file:"clear.js"},
  {category:"moderation",name:"ban",description:"حظر عضو من السيرفر مع إرسال إشعار له",file:"ban.js"},
  {category:"setup",name:"setup",description:"⚙️ فتح قائمة الإعدادات المركزية لجميع الأنظمة",file:"setup.js"},
  {category:"setup",name:"setup-welcome",description:"تعيين قناة الترحيب — تُرسَل فيها بطاقة ترحيب عند انضمام كل عضو",file:"setup-welcome.js"},
  {category:"setup",name:"setup-stats",description:"إعداد قنوات الإحصائيات الصوتية (تتحدث كل دقيقة)",file:"setup-stats.js"},
  {category:"setup",name:"setup-modlogs",description:"تعيين قناة سجلات الإشراف — ban/kick/timeout/warn والقنوات والأدوار",file:"setup-modlogs.js"},
  {category:"setup",name:"setup-logs",description:"تعيين قناة السجلات العامة — الانضمام والمغادرة والرسائل والصوت",file:"setup-logs.js"},
  {category:"setup",name:"setup-botlogs",description:"تعيين قناة سجل البوت — تُرسَل فيها إشعارات التشغيل والإيقاف والأخطاء والحالة",file:"setup-botlogs.js"},
  {category:"ticket",name:"ratings",description:"⭐ إدارة ومراقبة تقييمات المشرفين",file:"ratings.js"},
  {category:"ticket",name:"remind",description:"⏰ تذكير العضو بالرد على التكت",file:"remind.js"},
  {category:"ticket",name:"botinfo",description:"ℹ️ معلومات حول بوت FX9 Ticket System",file:"botinfo.js"},
  {category:"ticket",name:"announce",description:"📢 إرسال إعلان رسمي احترافي",file:"announce.js"},
  {category:"ticket",name:"stats",description:"📊 إحصائيات نظام التكتات FX9",file:"stats.js"},
  {category:"ticket",name:"helpt",description:"📖 دليل أوامر نظام التكتات FX9 — للإدارة فقط",file:"helpt.js"},
  {category:"ticket",name:"configt",description:"⚙️ إعداد نظام التكتات FX9 — للإدارة فقط",file:"configt.js"},
  {category:"ticket",name:"panel",description:"📋 إرسال بنل التكتات في القناة الحالية",file:"panel.js"},
  {category:"ticket",name:"ticket",description:"🎫 أدوات إدارة التكتات",file:"ticket.js"},
  {category:"voice",name:"vping",description:"فحص سرعة استجابة البوت الصوتي",file:"ping.js"},
  {category:"voice",name:"setup-voice",description:"إعداد نظام القنوات الصوتية المؤقتة",file:"setup-voice.js"},
  {category:"voice",name:"volume",description:"ضبط مستوى الصوت",file:"volume.js"},
  {category:"voice",name:"stop",description:"إيقاف الموسيقى وتفريغ القائمة",file:"stop.js"},
  {category:"voice",name:"skip",description:"تخطي المقطع الحالي",file:"skip.js"},
  {category:"voice",name:"shuffle",description:"خلط قائمة التشغيل عشوائياً",file:"shuffle.js"},
  {category:"voice",name:"search",description:"ابحث في يوتيوب واختر من 5 نتائج",file:"search.js"},
  {category:"voice",name:"remove",description:"حذف مقطع من قائمة التشغيل",file:"remove.js"},
  {category:"voice",name:"queue",description:"عرض قائمة التشغيل",file:"queue.js"},
  {category:"voice",name:"play",description:"تشغيل الموسيقى من يوتيوب",file:"play.js"},
  {category:"voice",name:"pause",description:"إيقاف مؤقت أو استكمال الموسيقى",file:"pause.js"},
  {category:"voice",name:"nowplaying",description:"عرض المقطع الحالي",file:"nowplaying.js"},
  {category:"voice",name:"loop",description:"وضع التكرار",file:"loop.js"},
  {category:"voice",name:"vchelp",description:"عرض أوامر الصوت والموسيقى",file:"help.js"},
  {category:"voice",name:"clearqueue",description:"تفريغ قائمة التشغيل",file:"clearqueue.js"},
];

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
  } catch {
    commands = FALLBACK_COMMANDS;
  }

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

router.post('/:guildId/update', isAuthenticated, hasGuildAccess, canModify, sanitizeInput, async (req, res) => {
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
      await axios.post(`${config.botApiUrl}/api/sync-command`, {
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

router.patch('/:guildId/update-description', isAuthenticated, hasGuildAccess, canModify, async (req, res) => {
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
      await axios.post(`${config.botApiUrl}/api/sync-command`, {
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

router.post('/:guildId/permissions', isAuthenticated, hasGuildAccess, canModify, async (req, res) => {
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
      await axios.post(`${config.botApiUrl}/api/sync-command`, {
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
