import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import config from '../config.js';
import { botFetch } from './botApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* The bot's command folder lives beside this repo, not inside it, so it only
   resolves when both are checked out together. On a deploy it is simply absent
   and the static list below is what the page renders. */
const BOT_COMMANDS_DIR = path.join(__dirname, '..', '..', '..', 'NEW SYS BOT', 'src', 'commands');

/* Last-resort copy, carried over verbatim from the list that used to sit inline
   in routes/commands.js. The live list comes from the bot itself; this is here so
   the page still reads as a real commands page when the bot API cannot be
   reached, rather than rendering an empty shell. It is deliberately not tidied —
   the emoji prefixes and the Latin brand strings are the bot's own wording, and
   editing them here would mean the degraded path said something different from
   the healthy one for no gain. */
export const FALLBACK_COMMANDS = [
  {category:"info",name:"ping",description:"فحص زمن استجابة البوت والاتصال",file:"ping.js"},
  {category:"info",name:"help",description:"عرض جميع الأوامر المتاحة مع شرحها",file:"help.js"},
  {category:"info",name:"sysinfo",description:"معلومات تفصيلية عن البوت والإحصائيات",file:"botinfo.js"},
  {category:"info",name:"userinfo",description:"معلومات تفصيلية عن عضو في السيرفر",file:"userinfo.js"},
  {category:"info",name:"serverinfo",description:"معلومات تفصيلية عن السيرفر الحالي",file:"serverinfo.js"},
  {category:"info",name:"config",description:"عرض إعدادات البوت الحالية لهذا السيرفر",file:"config.js"},
  {category:"members",name:"rules",description:"عرض قوانين السيرفر",file:"serverrules.js"},
  {category:"members",name:"rank",description:"عرض ترتيبك في السيرفر حسب تاريخ الانضمام",file:"rank.js"},
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
  {category:"moderation",name:"maintenance",description:"🛠️ إدارة وضع الصيانة للبوت",file:"maintenance.js"},
  {category:"setup",name:"setup",description:"⚙️ فتح قائمة الإعدادات المركزية لجميع الأنظمة",file:"setup.js"},
  {category:"setup",name:"setup-welcome",description:"تعيين قناة الترحيب — تُرسَل فيها بطاقة ترحيب عند انضمام كل عضو",file:"setup-welcome.js"},
  {category:"setup",name:"setup-stats",description:"إعداد قنوات الإحصائيات الصوتية (تتحدث كل دقيقة)",file:"setup-stats.js"},
  {category:"setup",name:"setup-modlogs",description:"تعيين قناة سجلات الإشراف — ban/kick/timeout/warn والقنوات والأدوار",file:"setup-modlogs.js"},
  {category:"setup",name:"setup-logs",description:"تعيين قناة السجلات العامة — الانضمام والمغادرة والرسائل والصوت",file:"setup-logs.js"},
  {category:"setup",name:"setup-botlogs",description:"تعيين قناة سجل البوت — تُرسَل فيها إشعارات التشغيل والإيقاف والأخطاء والحالة",file:"setup-botlogs.js"},
  {category:"ticket",name:"ratings",description:"⭐ إدارة ومراقبة تقييمات المشرفين",file:"ratings.js"},
  {category:"ticket",name:"remind",description:"⏰ تذكير العضو بالرد على التكت",file:"remind.js"},
  {category:"ticket",name:"botinfo",description:"ℹ️ معلومات حول بوت KRS Ticket System",file:"botinfo.js"},
  {category:"ticket",name:"stats",description:"📊 إحصائيات نظام التكتات KRS",file:"stats.js"},
  {category:"ticket",name:"helpt",description:"📖 دليل أوامر نظام التكتات KRS — للإدارة فقط",file:"helpt.js"},
  {category:"ticket",name:"configt",description:"⚙️ إعداد نظام التكتات KRS — للإدارة فقط",file:"configt.js"},
  {category:"ticket",name:"panel",description:"📋 إرسال بنل التكتات في القناة الحالية",file:"panel.js"},
  {category:"ticket",name:"ticket",description:"🎫 أدوات إدارة التكتات",file:"ticket.js"},
  {category:"ticket",name:"ticket-show",description:"🎫 عرض معلومات تكت برقمه",file:"ticketInfo.js"},
  {category:"voice",name:"vping",description:"فحص سرعة استجابة البوت الصوتي",file:"ping.js"},
  {category:"voice",name:"setup-voice",description:"إعداد نظام القنوات الصوتية المؤقتة",file:"setup-voice.js"},
  {category:"notifications",name:"notify",description:"🔔 إدارة إشتراكات الإشعارات (يوتيوب / كيك / تويتر)",file:"notify.js"},
  {category:"announcement",name:"announce",description:"📢 إرسال إعلان رسمي احترافي",file:"announce.js"},
];

/* Tabs on the public commands page, in the source's own order: everything first,
   then the broad sections, then the narrow ones. `all` is synthetic. */
export const CATEGORIES = [
  { id: 'all',            label: 'الجميع',        icon: 'fa-layer-group' },
  { id: 'info',           label: 'العام',         icon: 'fa-circle-info' },
  { id: 'members',        label: 'الأعضاء',       icon: 'fa-users' },
  { id: 'moderation',     label: 'الإشراف',       icon: 'fa-shield-halved' },
  { id: 'setup',          label: 'الإعدادات',     icon: 'fa-sliders' },
  { id: 'notifications',  label: 'الإشعارات',     icon: 'fa-bell' },
  { id: 'ticket',         label: 'التذكرة',       icon: 'fa-ticket' },
  { id: 'voice',          label: 'الرومات المؤقتة', icon: 'fa-headset' },
  { id: 'announcement',   label: 'الإعلانات',     icon: 'fa-bullhorn' },
];

const LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]));

/* ─── Usage ─────────────────────────────────────────────────────────────────
   src/data/commandUsage.json is generated from the bot's own SlashCommandBuilder
   definitions by scripts/gen-command-usage.mjs, so every argument name, its
   bound and the Discord permission a command demands is the bot's own wording —
   nothing here is written by hand and nothing can drift from the bot without
   re-running that script. Read through fs rather than a JSON import so the
   module loads identically on whatever Node the host is pinned to. */
const USAGE = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'commandUsage.json'), 'utf-8'));
  } catch {
    return {};
  }
})();

/* A command the generated table does not know still renders a usable panel — the
   bare invocation is all that can honestly be said about it. */
function usageFor(cmd) {
  const u = USAGE[cmd.name];
  const syntax = (u && u.syntax) || `/${cmd.name}`;
  return {
    syntax,
    examples: u && Array.isArray(u.examples) && u.examples.length ? u.examples : [syntax],
    permission: (u && u.permission) || null,
  };
}

/* /maintenance is the bot developer's own switch: it puts the whole bot into
   maintenance at once and neither a visitor nor a server admin can run it, so it
   does not belong on the public page. The per-guild admin page still lists it,
   where an owner may disable it per server like anything else. */
const NOT_PUBLIC = new Set(['maintenance']);

/* Anything the bot reports under a folder the tabs do not cover still has to
   render, so it is appended under its own name rather than dropped. */
function withLabels(list) {
  const known = new Set(CATEGORIES.map(c => c.id));
  const extra = [...new Set(list.map(c => c.category).filter(c => c && !known.has(c)))];
  for (const id of extra) LABEL[id] = id;
  return {
    categories: [...CATEGORIES, ...extra.map(id => ({ id, label: LABEL[id], icon: 'fa-hashtag' }))],
    commands: list.map(c => ({ ...c, category: c.category || 'info', label: LABEL[c.category] || c.category, usage: usageFor(c) })),
  };
}

/* ─── Order ────────────────────────────────────────────────────────────────
   tabOrder first (general to narrow, matching CATEGORIES), then anything the
   bot adds that the tabs did not know about, alphabetically. A bot that
   registers a new folder should appear at the end rather than reshuffle the
   page the reader is already looking at. */
function sortCommands(list) {
  const rank = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  const known = new Set(rank.keys());
  return [...list].sort((a, b) => {
    const ra = rank.has(a.category) ? rank.get(a.category) : 999;
    const rb = rank.has(b.category) ? rank.get(b.category) : 999;
    if (ra !== rb) return ra - rb;
    if (ra === 999) return String(a.category).localeCompare(String(b.category));
    return String(a.name).localeCompare(String(b.name));
  });
}

async function fromBotApi() {
  const res = await botFetch(`${config.botApiUrl}/api/commands`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const list = await res.json();
  if (!Array.isArray(list) || list.length === 0) return null;
  return list
    .filter(c => c && typeof c.name === 'string' && c.name)
    .map(c => ({
      name: String(c.name),
      description: String(c.description || ''),
      category: String(c.category || 'info'),
      file: String(c.file || ''),
    }));
}

/* Dev-only: read the command folder straight off disk when both repos sit side
   by side, so the page can be worked on without a running bot. */
function fromDisk() {
  try {
    const out = [];
    for (const dir of fs.readdirSync(BOT_COMMANDS_DIR)) {
      const dirPath = path.join(BOT_COMMANDS_DIR, dir);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      for (const file of fs.readdirSync(dirPath).filter(f => f.endsWith('.js'))) {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        const name = content.match(/\.setName\(['"](.+?)['"]\)/);
        if (!name) continue;
        const desc = content.match(/\.setDescription\(['"](.+?)['"]\)/);
        out.push({ name: name[1], description: desc ? desc[1] : '', category: dir, file });
      }
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/* ─── Cache ────────────────────────────────────────────────────────────────
   The bot API is a separate service and this page is public, so an unbounded
   hit rate would let every visitor open a socket to the bot. One list, held for
   a minute, is enough — the command set changes far slower than that. Failures
   are cached too, so a bot that is down does not get re-dialled per visitor. */
const TTL = 60_000;
let cache = null;

export async function getCommandCatalog({ fresh = false, publicOnly = false } = {}) {
  if (!fresh && cache && cache.expires > Date.now()) return cache.value;

  let source = 'bot';
  let list = null;
  try { list = await fromBotApi(); } catch { list = null; }
  if (!list) { source = 'disk'; list = fromDisk(); }
  if (!list) { source = 'fallback'; list = FALLBACK_COMMANDS; }

  // Filtered before labelling, so a category that only held a developer command
  // is not left behind as an empty tab.
  const shown = publicOnly ? list.filter(c => !NOT_PUBLIC.has(c.name)) : list;

  const value = { ...withLabels(sortCommands(shown)), source, total: shown.length };
  cache = { value, expires: Date.now() + TTL };
  return value;
}