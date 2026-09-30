// ════════════════════════════════════════════════════════════════
//  botApi.js — مساعد الاتصال الموحّد مع API البوت
//
//  لماذا هذا الملف؟
//  الداشبورد يتصل بـ API البوت من 25+ مكان في الكود. بعد نقل
//  الداشبورد لاستضافة أخرى، هذا الرابط أصبح عاماً على الإنترنت،
//  فيجب إرسال سر مشترك (API_SECRET) مع كل طلب.
//
//  الحل: نوفّر طبقة واحدة تضيف الترويسة تلقائياً، ونمرّرها بدل
//  fetch مباشرة. كل الاستدعاءات الحالية تستمر كعملهاً، لكن آمنة.
// ════════════════════════════════════════════════════════════════
import config from '../config.js';

/** يبني ترويسة المصادقة المشتركة مع API البوت */
export function apiHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (config.apiSecret) h['x-api-key'] = config.apiSecret;
  return h;
}

/**
 * fetch موجّه نحو API البوت مع الترويسة تلقائياً.
 * الاستخدام:  botFetch('/api/guilds')   بدل   fetch(`${config.botApiUrl}/api/guilds`)
 */
export function botFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${config.botApiUrl}${path}`;
  return fetch(url, { ...options, headers: apiHeaders(options.headers || {}) });
}

/** نسخة axios للفيديو/العناصر التي تستخدم axios.post */
export function botPost(path, body, options = {}) {
  const url = path.startsWith('http') ? path : `${config.botApiUrl}${path}`;
  return axiosPost(url, body, { ...options, headers: apiHeaders(options.headers || {}) });
}

// نُحمّل axios بشكل كسول لتفادي تحميله إن لم يُستخدم
let _axios = null;
async function axiosPost(url, body, options) {
  if (!_axios) {
    const mod = await import('axios');
    _axios = mod.default || mod;
  }
  return _axios.post(url, body, options);
}

export default { botFetch, botPost, apiHeaders };
