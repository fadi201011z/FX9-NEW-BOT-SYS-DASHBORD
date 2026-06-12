import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  guildId: { type: String, index: true },
  action: { type: String, required: true },
  field: String,
  oldValue: String,
  newValue: String,
  ipAddress: String,
  sessionId: String,
  timestamp: { type: Number, default: Date.now },
}, { timestamps: true });

auditLogSchema.index({ guildId: 1, timestamp: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
