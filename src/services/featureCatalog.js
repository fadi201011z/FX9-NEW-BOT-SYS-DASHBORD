/**
 * featureCatalog.js — التعريف الوحيد لخصائص البوت في اللوحة.
 *
 * مفاتيح الخصائص هنا يجب أن تطابق حرفياً ما في البوت
 * (FX9-BOT-SYS-main/src/utils/features.js):
 *   tickets · temp_voice · notifications · welcome
 *   logging · protection · moderation · setup · info · announcements
 *
 * `folders` يربط كل خصيصة بمجلدات أوامر البوت التي تخدمها، فيمكن للصفحة
 * أن تعرض عدد الأوامر المشمولة بكل خصيصة من كتالوج الأوامر نفسه.
 */

export const FEATURE_STATES = ['on', 'off', 'maintenance'];

/** الوصف العربي لكل حالة — يُستخدم في الواجهة وفي السجل. */
export const STATE_META = {
  on:          { label: 'تعمل',    short: 'تشغيل',  icon: 'fa-circle-play',        tone: 'on' },
  off:         { label: 'معطّلة',  short: 'تعطيل',  icon: 'fa-circle-xmark',       tone: 'off' },
  maintenance: { label: 'صيانة',   short: 'صيانة',  icon: 'fa-screwdriver-wrench', tone: 'maint' },
};

export const FEATURE_GROUPS = [
  { id: 'systems',  name: 'الأنظمة الأساسية', icon: 'fa-layer-group' },
  { id: 'security', name: 'الأمان والحماية',  icon: 'fa-shield-halved' },
  { id: 'commands', name: 'الأوامر',          icon: 'fa-terminal' },
];

export const FEATURE_CATALOG = [
  {
    key: 'tickets',
    name: 'نظام التذاكر',
    icon: 'fa-ticket',
    group: 'systems',
    folders: ['ticket'],
    desc: 'لوحة التذاكر، إنشاء التذاكر وتراسلها بين الأعضاء والإدارة، وتقييم المشرفين والإغلاق التلقائي عند الخمول.',
  },
  {
    key: 'temp_voice',
    name: 'الرومات الصوتية المؤقتة',
    icon: 'fa-microphone',
    group: 'systems',
    folders: ['voice'],
    desc: 'إنشاء روم صوتي تلقائياً عند الانضمام، مع أدوات القفل والإخفاء وضبط الحد ونقل الملكية والحذف عند الخلو.',
  },
  {
    key: 'notifications',
    name: 'الإشعارات',
    icon: 'fa-bell',
    group: 'systems',
    folders: ['notifications'],
    desc: 'متابعة قنوات يوتيوب وتويتش وتويتر وإرسال تنبيهات البث والفيديوهات الجديدة إلى قنوات السيرفر.',
  },
  {
    key: 'welcome',
    name: 'الترحيب والأعضاء',
    icon: 'fa-hand-sparkles',
    group: 'systems',
    folders: [],
    desc: 'رسالة الترحيب وبطاقتها، الرتبة التلقائية للأعضاء الجدد، وكشف موجات الانضمام المشبوهة (الريد).',
  },
  {
    key: 'logging',
    name: 'سجلات السيرفر',
    icon: 'fa-scroll',
    group: 'security',
    folders: [],
    desc: 'تسجيل الرسائل والرتب والقنوات وعمليات الانضمام والمغادرة والحظر في قنوات السجل.',
  },
  {
    key: 'protection',
    name: 'الحماية والمكافحة',
    icon: 'fa-shield-halved',
    group: 'security',
    folders: [],
    desc: 'مكافحة السبام والتكرار، منع الروابط، ملاحقة المنشن الجماعي، وحراسة الرومات المقيّدة بالحظر.',
  },
  {
    key: 'moderation',
    name: 'أوامر الإدارة',
    icon: 'fa-hammer',
    group: 'commands',
    folders: ['moderation'],
    desc: 'الحظر والطرد والكتم والتحذيرات وقفل القنوات وإدارة الرتب والأوامر الإشرافية.',
  },
  {
    key: 'setup',
    name: 'إعداد السيرفر',
    icon: 'fa-screwdriver-wrench',
    group: 'commands',
    folders: ['setup'],
    desc: 'أوامر التهيئة الأولى: إعداد التذاكر والترحيب والسجلات وقنوات الإحصائيات.',
  },
  {
    key: 'info',
    name: 'الأوامر العامة',
    icon: 'fa-circle-info',
    group: 'commands',
    folders: ['info', 'members'],
    desc: 'معلومات البوت والسيرفر والأعضاء، وأوامر الأدوات والمساعدة والقوانين.',
  },
  {
    key: 'announcements',
    name: 'الإعلانات',
    icon: 'fa-bullhorn',
    group: 'commands',
    folders: ['announcement'],
    desc: 'إرسال الإعلانات الرسمية والتنبيهات إلى قنوات السيرفر.',
  },
];

/** مجلد أمر البوت → مفتاح الخصيصة (لمطابقة كتالوج الأوامر). */
export const FOLDER_TO_FEATURE = Object.freeze({
  ticket: 'tickets',
  voice: 'temp_voice',
  notifications: 'notifications',
  moderation: 'moderation',
  setup: 'setup',
  announcement: 'announcements',
  info: 'info',
  members: 'info',
});

/** يوزّع أوامر كتالوج البوت على الخصائص: { featureKey: [names] }. */
export function groupCommandsByFeature(commands) {
  const out = {};
  for (const f of FEATURE_CATALOG) out[f.key] = [];
  for (const c of commands || []) {
    const key = FOLDER_TO_FEATURE[c.category];
    if (key && out[key]) out[key].push(c.name);
  }
  for (const key of Object.keys(out)) out[key].sort();
  return out;
}