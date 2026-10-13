import mongoose from 'mongoose';

// سجلات سيرفر ديسكورد الحقيقية — يرسلها البوت إلى اللوحة.
// تُخزَّن مؤقتاً فقط: فهرس TTL يحذف ما تجاوز 48 ساعة، ومهمة التنظيف الدورية
// في index.js تغطي الحالات التي لا يعمل فيها فهرس TTL (تغيير المدة عبر env).
const serverLogSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String },
  // server = log_channel (نشاط عام) · mod = modlog_channel (إشراف) · bot = botlog_channel (البوت)
  source: { type: String, enum: ['server', 'mod', 'bot'], default: 'server' },
  content: { type: String },
  embeds: { type: Array, default: [] },
  timestamp: { type: Number, default: Date.now },
}, { timestamps: true });

serverLogSchema.index({ guildId: 1, timestamp: -1 });
// شبكة أمان ثانية: فهرس TTL يحذف المستندات المنتهية تلقائياً. مدّته تتبع
// LOG_RETENTION_HOURS (الافتراضي 48 ساعة) لتتوافق مع مهمة التنظيف في index.js.
const RETENTION_HOURS = Math.max(1, parseInt(process.env.LOG_RETENTION_HOURS, 10) || 48);
serverLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_HOURS * 3600 });

export default mongoose.model('ServerLog', serverLogSchema);
