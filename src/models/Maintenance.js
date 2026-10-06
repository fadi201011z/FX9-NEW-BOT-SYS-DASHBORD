import mongoose from 'mongoose';

/**
 * وضع الصيانة — صفّ واحد يحمل حالتين مستقلتين:
 *
 *   • الموقع  (enabled / endTime / durationMinutes / message)
 *       يقرؤها وسيط الصيانة في اللوحة فيحوّل الزوّار إلى صفحة /maintenance،
 *       ويقرؤها الشريط العام (landing-script) عبر /dev/maintenance/status.
 *       الأسماء القديمة بقيت كما هي حتى لا ينكسر أي مسار قائم.
 *
 *   • البوت   (botEnabled / botEndTime / botDurationMinutes / botMessage)
 *       يقرؤها البوت من هذه المجموعة نفسها: يوقف الأوامر ويتغيّر حضوره،
 *       ويرسل إشعار البدء/الانتهاء إلى قناة channelId.
 *
 * الحالتان منفصلتان: يمكن إدخال البوت في الصيانة دون إغلاق الموقع والعكس.
 */
const maintenanceSchema = new mongoose.Schema({
  // ── الموقع ──
  enabled:  { type: Boolean, default: false },
  endTime:  { type: Number, default: null },
  durationMinutes: { type: Number, default: 0 },
  message:  { type: String, default: 'الموقع تحت الصيانة حالياً. سنعود قريباً!' },

  // ── البوت ──
  botEnabled: { type: Boolean, default: false },
  botEndTime: { type: Number, default: null },
  botDurationMinutes: { type: Number, default: 0 },
  botMessage: { type: String, default: 'The bot is under maintenance and development. Please check back later.' },
  botStartedAt: { type: Number, default: null },

  // قناة إشعارات الصيانة في ديسكورد (يستخدمها البوت فقط)
  channelId:{ type: String, default: '' },

  updatedAt:{ type: Number, default: Date.now },
  updatedBy:{ type: String, default: '' },
  changelog:{ type: Object, default: { botUpdates: '', siteUpdates: '' } },
}, { timestamps: true });

export default mongoose.model('Maintenance', maintenanceSchema);