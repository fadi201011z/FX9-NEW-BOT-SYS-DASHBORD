/* ═══════════════════════════════════════════════════════════════════════════
   مركز الإعدادات — الصفحات والمتغيّرات المشتقّة

   The centre used to be one page: src/views/guild/settings.ejs, 2,640 lines
   that held eight cards, their styles and their script in one file. Every card
   was a setting, and every setting belonged to a system the rail already had a
   name for, so the page was split along the lines the rail already drew.

   Each page renders one part of the centre and posts only the fields it shows.
   POST /:guildId/save iterates Object.entries(settings) and writes each key on
   its own, so a form that sends four keys changes four keys -- and, just as
   importantly, cannot blank the other forty. That is why collectSettings() in
   the shared script skips a field the page does not contain instead of sending
   an empty string for it.

   This module is what both halves need and neither should own twice: the page
   table (so a route and the rail cannot disagree about a slug) and the derived
   values every shared partial reads (premium, waInit, stSteps, ...). It is kept
   free of config.js and database.js on purpose: it is pure, so it can be
   imported by a render check without a database behind it.
   ═══════════════════════════════════════════════════════════════════════════ */

// مفاتيح الصور المخصّصة لكل سيرفر (تُقرأ من البوت عبر guildImage.js)
export const CUSTOM_IMAGE_KEYS = ['welcome_image', 'ticket_panel_image', 'voice_panel_image'];

// slug → القالب والعنوان. الرابط في القائمة الجانبية يُبنى من هذا الجدول أيضاً.
export const SETTINGS_PAGES = {
  general:        { view: 'guild/settings/general',     title: 'الإعدادات العامة' },
  welcome:        { view: 'guild/settings/welcome',     title: 'نظام الترحيب' },
  logs:           { view: 'guild/settings/logs',        title: 'قنوات السجلات' },
  'voice-stats':  { view: 'guild/settings/voice-stats', title: 'الإحصائيات الصوتية' },
  tickets:        { view: 'guild/settings/tickets',     title: 'إعدادات التذاكر' },
  support:        { view: 'guild/settings/support',     title: 'فريق الدعم' },
  'voice-rooms':  { view: 'guild/settings/voice-rooms', title: 'إعدادات الرومات الصوتية' },
  systems:        { view: 'guild/settings/systems',     title: 'أنظمة أخرى' },
};

// يبني كل المتغيّرات المشتقّة التي تحتاجها القوالب المشتركة (الهيدر، الدليل، المحرّرات).
export function buildSettingsLocals(data, guild, user) {
  const cfg = data.config;

  const ticketReady = ['panel_channel', 'ticket_category', 'admin_category', 'log_channel_id'].filter(k => cfg[k]).length;
  const logReady = ['log_channel', 'modlog_channel', 'botlog_channel'].filter(k => cfg[k]).length;
  const statsReady = ['stats_total', 'stats_online', 'stats_bots'].filter(k => cfg[k]).length;
  const welcomeSet = !!cfg.welcome_channel;
  const supportCount = (data.supportRoleArray || []).length;
  const premExp = Number(cfg.premium_expires_at) || 0;
  const premium = (cfg.premium_plan && premExp > Date.now())
    ? { plan: cfg.premium_plan, daysLeft: Math.max(1, Math.ceil((premExp - Date.now()) / 86400000)) }
    : null;
  const imgCustom = CUSTOM_IMAGE_KEYS.filter(k => cfg[k]).length;

  // مُهيّئات محرر صورة الترحيب: الموضع/الحجم/الإطار الافتراضية + صورة العضو التجريبية.
  const waNum = (v, d) => {
    const n = Number(v);
    return (v === undefined || v === null || v === '' || !Number.isFinite(n)) ? d : n;
  };
  const waInit = {
    x: waNum(cfg.welcome_avatar_x, 1340),
    y: waNum(cfg.welcome_avatar_y, 527),
    size: waNum(cfg.welcome_avatar_size, 512),
    ring: cfg.welcome_avatar_ring === undefined ? true : String(cfg.welcome_avatar_ring) === '1',
    ringColor: /^#[0-9a-f]{6}$/i.test(cfg.welcome_avatar_ring_color || '') ? cfg.welcome_avatar_ring_color : '#ffffff',
    ringWidth: waNum(cfg.welcome_avatar_ring_width, 5),
  };
  const waAvatarUrl = (user && user.avatar && user.id)
    ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=256'
    : 'https://cdn.discordapp.com/embed/avatars/' + (Number(user && user.discriminator) % 5) + '.png';

  // خطوات دليل البدء: ما تفعله كل خاصية ولماذا تفيدك — مبنية من نفس الإعدادات.
  // كل خطوة تقود إلى صفحتها، لا إلى مرساة داخل صفحة واحدة كما كان.
  const stSteps = [
    { id: 'st-welcome', href: `/settings/${guild.id}/welcome`, icon: 'fa-door-open', name: 'تفعيل بطاقة الترحيب', desc: 'بطاقة باسم العضو وصورته ورقمه تُرسل تلقائياً عند دخوله السيرفر', done: welcomeSet, label: welcomeSet ? 'مفعّلة' : 'لم تُفعّل بعد' },
    { id: 'st-logs', href: `/settings/${guild.id}/logs`, icon: 'fa-clipboard-list', name: 'توجيه قنوات السجلات', desc: 'السجلات العامة والإشراف والبوت — لكل نوع قناة خاصة به (أو واحدة للجميع)', done: logReady >= 1, label: logReady + ' من 3 قنوات' },
    { id: 'st-stats', href: `/settings/${guild.id}/voice-stats`, icon: 'fa-chart-line', name: 'إنشاء رومات الإحصائيات', desc: 'رومات صوتية تعرض الأعداد في الاسم وتتحدث تلقائياً كل دقيقة', done: statsReady >= 1, label: statsReady + ' من 3 رومات' },
    { id: 'st-tickets', href: `/settings/${guild.id}/tickets`, icon: 'fa-ticket', name: 'استكمال نظام التذاكر', desc: 'بنل + تصنيف التذاكر + تصنيفها الداخلي + سجلها — أربع خطوات مرتبطة', done: ticketReady >= 3, label: ticketReady + ' من 4 خطوات' },
    { id: 'st-support', href: `/settings/${guild.id}/support`, icon: 'fa-headset', name: 'اختيار فريق الدعم', desc: 'الرتب التي تتسلم التذاكر الجديدة وترد عليها وتديرها', done: supportCount > 0, label: supportCount > 0 ? supportCount + ' رتبة' : 'لا رتب بعد' },
    { id: 'st-images', href: `/settings/${guild.id}/welcome`, icon: 'fa-images', name: 'تخصيص صور النظام', desc: 'خلفية الترحيب في صفحة الترحيب، وصور بنل التذاكر والصوتيات في صفحاتها', done: imgCustom > 0, label: imgCustom > 0 ? imgCustom + ' مخصصة' : 'الافتراضية' },
  ];
  const statusCells = [
    { icon: 'fa-door-open', name: 'الترحيب', v: welcomeSet, sub: welcomeSet ? 'مفعّل' : 'متوقف' },
    { icon: 'fa-clipboard-list', name: 'السجلات', v: logReady, max: 3, sub: logReady + '/3' },
    { icon: 'fa-chart-line', name: 'الإحصائيات', v: statsReady, max: 3, sub: statsReady + '/3' },
    { icon: 'fa-ticket', name: 'التذاكر', v: ticketReady, max: 4, sub: ticketReady + '/4' },
    { icon: 'fa-headset', name: 'الدعم', v: supportCount, sub: supportCount + (supportCount === 1 ? ' رتبة' : ' رتب') },
  ];
  const sysTiles = [
    ['/protection/' + guild.id, 'fa-shield-halved', 'نظام الحماية', '5 أنظمة ضد الهجمات وسبام'],
    ['/commands/' + guild.id, 'fa-terminal', 'الأوامر', 'إدارة وتفعيل أوامر البوت'],
    ['/voice/' + guild.id, 'fa-microphone', 'الرومات المؤقتة', 'غرف صوتية تُنشأ عند دخول العضو'],
    ['/notifications/' + guild.id, 'fa-bell', 'الإشعارات والإمبد', 'إشعارات تنبيه صوت نصي للمتابعة'],
    ['/backup/' + guild.id, 'fa-database', 'النسخ الاحتياطي', 'نسخ احتياطية لإعدادات السيرفر'],
    ['/admins/' + guild.id, 'fa-users-gear', 'المدراء', 'من يستطيع التحكم في اللوحة'],
  ];

  return {
    ...data,
    premium, imgCustom, waInit, waAvatarUrl, stSteps, statusCells, sysTiles,
    currentPage: 'settings',
    settingsPage: 'general',
  };
}
