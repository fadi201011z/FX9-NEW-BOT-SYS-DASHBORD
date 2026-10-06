import mongoose from 'mongoose';

/**
 * features — الحالة العامة لخصائص البوت (control plane).
 *
 * هذه الوثائق يكتبها المطوّر من صفحة /dev/features، ثم تُدفَع إلى البوت
 * عبر POST /api/features/sync ليفرضها فوراً ويتجاهلها لدورة التحديث التالية.
 * مفاتيح الخصائص ثابتة ومشتركة بين اللوحتين (انظر services/featureCatalog.js).
 *
 * state:
 *   'on'          — تعمل طبيعياً
 *   'off'         — معطّلة تماماً
 *   'maintenance' — قيد الصيانة: تُعرَض رسالة بدل التنفيذ
 */
const featureSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true, index: true },
  state:     { type: String, enum: ['on', 'off', 'maintenance'], default: 'on' },
  message:   { type: String, default: '' },
  updatedBy: { type: String, default: '' },
  updatedAt: { type: Number, default: Date.now },
});

export default mongoose.model('Feature', featureSchema);