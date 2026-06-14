import { readdir } from 'fs/promises';
import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, '..', '..', '..', 'NEW SYS BOT', 'src', 'commands');

const FALLBACK_COMMANDS = [
  {category:"info",name:"ping",description:"فحص زمن استجابة البوت والاتصال",options:[]},
  {category:"info",name:"help",description:"عرض جميع الأوامر المتاحة مع شرحها",options:[]},
  {category:"info",name:"sysinfo",description:"معلومات تفصيلية عن البوت والإحصائيات",options:[]},
  {category:"info",name:"userinfo",description:"معلومات تفصيلية عن عضو في السيرفر",options:[]},
  {category:"info",name:"serverinfo",description:"معلومات تفصيلية عن السيرفر الحالي",options:[]},
  {category:"info",name:"config",description:"عرض إعدادات البوت الحالية لهذا السيرفر",options:[]},
  {category:"members",name:"rules",description:"عرض قوانين السيرفر",options:[]},
  {category:"members",name:"rank",description:"عرض ترتيبك في السيرفر حسب تاريخ الانضمام",options:[]},
  {category:"members",name:"profile",description:"عرض ملف عضو بشكل احترافي",options:[]},
  {category:"members",name:"avatar",description:"عرض صورة عضو بأعلى دقة ممكنة",options:[]},
  {category:"moderation",name:"warn",description:"نظام التحذيرات — إضافة أو عرض أو مسح تحذيرات الأعضاء",options:[]},
  {category:"moderation",name:"unlock",description:"فتح قناة مغلقة والسماح للأعضاء بالإرسال فيها",options:[]},
  {category:"moderation",name:"unhide",description:"إظهار قناة مخفية للأعضاء العاديين",options:[]},
  {category:"moderation",name:"timeout",description:"إيقاف عضو مؤقتاً لمدة محددة (كتم)",options:[]},
  {category:"moderation",name:"slowmode",description:"ضبط وضع البطء في القناة الحالية",options:[]},
  {category:"moderation",name:"role",description:"إضافة أو إزالة رتبة من عضو في السيرفر",options:[]},
  {category:"moderation",name:"nick",description:"تغيير أو إعادة ضبط لقب عضو",options:[]},
  {category:"moderation",name:"lock",description:"إغلاق قناة ومنع الأعضاء من الإرسال فيها",options:[]},
  {category:"moderation",name:"kick",description:"طرد عضو من السيرفر مع إرسال إشعار له",options:[]},
  {category:"moderation",name:"hide",description:"إخفاء قناة عن الأعضاء العاديين",options:[]},
  {category:"moderation",name:"clear",description:"مسح رسائل بشكل جماعي مع فلاتر اختيارية",options:[]},
  {category:"moderation",name:"ban",description:"حظر عضو من السيرفر مع إرسال إشعار له",options:[]},
  {category:"setup",name:"setup",description:"⚙️ فتح قائمة الإعدادات المركزية لجميع الأنظمة",options:[]},
  {category:"setup",name:"setup-welcome",description:"تعيين قناة الترحيب — تُرسَل فيها بطاقة ترحيب عند انضمام كل عضو",options:[]},
  {category:"setup",name:"setup-stats",description:"إعداد قنوات الإحصائيات الصوتية (تتحدث كل دقيقة)",options:[]},
  {category:"setup",name:"setup-modlogs",description:"تعيين قناة سجلات الإشراف — ban/kick/timeout/warn والقنوات والأدوار",options:[]},
  {category:"setup",name:"setup-logs",description:"تعيين قناة السجلات العامة — الانضمام والمغادرة والرسائل والصوت",options:[]},
  {category:"setup",name:"setup-botlogs",description:"تعيين قناة سجل البوت — تُرسَل فيها إشعارات التشغيل والإيقاف والأخطاء والحالة",options:[]},
  {category:"ticket",name:"ratings",description:"⭐ إدارة ومراقبة تقييمات المشرفين",options:[]},
  {category:"ticket",name:"remind",description:"⏰ تذكير العضو بالرد على التكت",options:[]},
  {category:"ticket",name:"botinfo",description:"ℹ️ معلومات حول بوت FX9 Ticket System",options:[]},
  {category:"ticket",name:"announce",description:"📢 إرسال إعلان رسمي احترافي",options:[]},
  {category:"ticket",name:"stats",description:"📊 إحصائيات نظام التكتات FX9",options:[]},
  {category:"ticket",name:"helpt",description:"📖 دليل أوامر نظام التكتات FX9 — للإدارة فقط",options:[]},
  {category:"ticket",name:"configt",description:"⚙️ إعداد نظام التكتات FX9 — للإدارة فقط",options:[]},
  {category:"ticket",name:"panel",description:"📋 إرسال بنل التكتات في القناة الحالية",options:[]},
  {category:"ticket",name:"ticket",description:"🎫 أدوات إدارة التكتات",options:[]},
  {category:"ticket",name:"ticket-show",description:"🎫 عرض معلومات تكت برقمه",options:[]},
  {category:"voice",name:"vping",description:"فحص سرعة استجابة البوت الصوتي",options:[]},
  {category:"voice",name:"setup-voice",description:"إعداد نظام القنوات الصوتية المؤقتة",options:[]},
  {category:"voice",name:"volume",description:"ضبط مستوى الصوت",options:[]},
  {category:"voice",name:"stop",description:"إيقاف الموسيقى وتفريغ القائمة",options:[]},
  {category:"voice",name:"skip",description:"تخطي المقطع الحالي",options:[]},
  {category:"voice",name:"shuffle",description:"خلط قائمة التشغيل عشوائياً",options:[]},
  {category:"voice",name:"search",description:"ابحث في يوتيوب واختر من 5 نتائج",options:[]},
  {category:"voice",name:"remove",description:"حذف مقطع من قائمة التشغيل",options:[]},
  {category:"voice",name:"queue",description:"عرض قائمة التشغيل",options:[]},
  {category:"voice",name:"play",description:"تشغيل الموسيقى من يوتيوب",options:[]},
  {category:"voice",name:"pause",description:"إيقاف مؤقت أو استكمال الموسيقى",options:[]},
  {category:"voice",name:"nowplaying",description:"عرض المقطع الحالي",options:[]},
  {category:"voice",name:"loop",description:"وضع التكرار",options:[]},
  {category:"voice",name:"vchelp",description:"عرض أوامر الصوت والموسيقى",options:[]},
  {category:"voice",name:"clearqueue",description:"تفريغ قائمة التشغيل",options:[]},
];

export async function getDocumentation() {
  const docs = [];
  const categories = ['setup', 'moderation', 'info', 'members', 'ticket', 'voice'];

  for (const cat of categories) {
    const dir = path.join(COMMANDS_DIR, cat);
    let files;
    try { files = await readdir(dir); } catch { continue; }

    for (const file of files.filter(f => f.endsWith('.js'))) {
      try {
        const mod = await import(pathToFileURL(path.join(dir, file)).href);
        if (mod.data) {
          docs.push({
            name: mod.data.name,
            description: mod.data.description,
            category: cat,
            options: mod.data.options || [],
          });
        }
      } catch {}
    }
  }

  return docs.length > 0 ? docs : FALLBACK_COMMANDS;
}

export function getCommandStats() {
  const perCategory = {};
  let total = 0;

  try {
    const dirs = readdirSync(COMMANDS_DIR);
    for (const dir of dirs) {
      const dirPath = path.join(COMMANDS_DIR, dir);
      if (!statSync(dirPath).isDirectory()) continue;

      const files = readdirSync(dirPath).filter(f => f.endsWith('.js'));
      let count = 0;

      for (const file of files) {
        const content = readFileSync(path.join(dirPath, file), 'utf-8');
        if (/\.setName\(['"`]/.test(content)) count++;
      }

      if (count > 0) {
        perCategory[dir] = count;
        total += count;
      }
    }
  } catch {
    // fallback: count from FALLBACK_COMMANDS
    for (const cmd of FALLBACK_COMMANDS) {
      perCategory[cmd.category] = (perCategory[cmd.category] || 0) + 1;
    }
    total = FALLBACK_COMMANDS.length;
  }

  return { total, categories: Object.keys(perCategory), perCategory };
}
