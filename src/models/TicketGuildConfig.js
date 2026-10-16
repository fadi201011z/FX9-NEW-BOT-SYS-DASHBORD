import mongoose from 'mongoose';

// ─── أقسام التذاكر القابلة للتخصيص ──────────────────────────────────────────
// قسم واحد = خيار واحد في قائمة بنل التذاكر + النموذج الذي يملؤه العضو بعده.
// اللوحة تحرّر هذه الأقسام، والبوت يبني منها القائمة والنموذج معاً. عندما تكون
// القائمة فارغة يعود البوت إلى أقسامه الافتراضية المضمّنة داخل الكود.

// حقل واحد داخل نموذج القسم — يطابق قيود ديسكورد: التسمية 45 حرفاً، والنص
// البديل 100، والطول الأقصى 4000. أي نموذج (Modal) يقبل 5 حقول كحد أقصى.
const ticketFieldSchema = new mongoose.Schema({
  id:          { type: String, default: '' },
  label:       { type: String, default: '' },
  placeholder: { type: String, default: '' },
  style:       { type: String, default: 'short' },   // 'short' | 'paragraph'
  required:    { type: Boolean, default: false },
  maxLength:   { type: Number, default: 500 },
}, { _id: false });

const ticketSectionSchema = new mongoose.Schema({
  id:             { type: String, required: true },  // يُستخدم في القناة والـ customId
  emoji:          { type: String, default: '🎫' },
  label:          { type: String, default: '' },     // الاسم الظاهر في القائمة
  description:    { type: String, default: '' },     // سطر الشرح تحت الاسم
  color:          { type: String, default: '' },     // لون إمبد التذكرة (#rrggbb)
  enabled:        { type: Boolean, default: true },
  supportRoleIds: { type: [String], default: [] },   // يتجاوز رتب الدعم العامة إن وُجد
  fields:         { type: [ticketFieldSchema], default: [] },
}, { _id: false });

const ticketGuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  ticketCategoryId: { type: String, default: '' },
  adminCategoryId: { type: String, default: '' },
  panelChannelId: { type: String, default: '' },
  logChannelId: { type: String, default: '' },
  supportRoleIds: { type: [String], default: [] },
  ticketCounter: { type: Number, default: 0 },
  sections: { type: [ticketSectionSchema], default: [] },
}, { timestamps: true });

export default mongoose.model('TicketGuildConfig', ticketGuildConfigSchema);
