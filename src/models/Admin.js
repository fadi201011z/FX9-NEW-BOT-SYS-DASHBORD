import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  guildId: { type: String, required: true, index: true },
  role: { type: String, default: 'moderator' },
  addedBy: String,
  addedAt: { type: Number, default: Date.now },
  permissions: { type: Object, default: {} },
}, { timestamps: true });

adminSchema.index({ userId: 1, guildId: 1 }, { unique: true });

export default mongoose.model('Admin', adminSchema);
