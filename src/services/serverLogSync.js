// ════════════════════════════════════════════════════════════════
//  serverLogSync.js — يسحب سجلات سيرفر ديسكورد من البوت ويخزّنها.
//
//  البوت يعكس رسائله إلى قنوات السجلات ويحتفظ بآخر الأحداث في ذاكرته.
//  هذه الطبقة تسأل البوت عن أحداث سيرفر معيّن وتُدخلها في قاعدة بيانات
//  اللوحة (موضع الاحتفاظ 48 ساعة)، فيظهر السجل حتى لو لم يُضبط
//  DASHBOARD_URL على البوت (أي أن الدفع الفوري غير مُفعّل).
//
//  كل الأعطال (بوت متوقف، إصدار قديم، مهلة) تُبتلع وتُعاد كحالة، فلا
//  تمنع عرض الصفحة أبداً.
// ════════════════════════════════════════════════════════════════
import { botFetch } from './botApi.js';
import { saveServerLogs } from '../database.js';

const TIMEOUT_MS = 3_500;
const MAX_LOGS = 300;

/** يُطبّع سجلاً واحداً قادماً من البوت، ويتجاهل غير الصالح. */
function normalize(raw, guildId) {
  if (!raw || typeof raw !== 'object') return null;
  const timestamp = Number(raw.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  const source = ['server', 'mod', 'bot'].includes(raw.source) ? raw.source : 'server';
  const embeds = Array.isArray(raw.embeds)
    ? raw.embeds.filter((e) => e && typeof e === 'object').slice(0, 5)
    : [];

  const doc = {
    guildId,
    source,
    timestamp,
    embeds,
  };
  if (raw.eventId) doc.eventId = String(raw.eventId);
  if (raw.channelId) doc.channelId = String(raw.channelId);
  if (typeof raw.content === 'string') doc.content = raw.content.slice(0, 2_000);
  return doc;
}

/**
 * يسحب أحداث البوت للسيرفر ويعيد حالة التشخيص:
 *   reachable — هل استجاب البوت أصلاً؟
 *   ok        — هل نقطة السجلات متاحة (إصدار البوت حديث)؟
 *   channels  — أي قنوات سجلات مضبوطة على البوت ({ server, mod, bot }).
 */
export async function syncServerLogs(guildId) {
  const result = { reachable: false, ok: false, saved: 0, channels: null, status: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await botFetch(
        `/api/dashboard-log?guildId=${encodeURIComponent(guildId)}&limit=${MAX_LOGS}`,
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timer);
    }

    result.reachable = true;
    if (!res || !res.ok) return result; // بوت قديم لا يملك هذه النقطة

    const data = await res.json().catch(() => null);
    if (!data) return result;

    result.ok = true;
    result.status = data.status || null;
    result.channels = data.status?.channels || null;

    const logs = Array.isArray(data.logs) ? data.logs : [];
    const docs = logs.slice(0, MAX_LOGS).map((l) => normalize(l, guildId)).filter(Boolean);
    if (docs.length) result.saved = await saveServerLogs(docs);
    return result;
  } catch {
    return result;
  }
}

export default { syncServerLogs };
