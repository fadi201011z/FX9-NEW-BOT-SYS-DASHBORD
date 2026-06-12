import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  guildId: { type: String, index: true },
  type: { type: String, required: true },
  severity: { type: String, default: 'info' },
  title: String,
  message: String,
  read: { type: Boolean, default: false },
  timestamp: { type: Number, default: Date.now },
}, { timestamps: true });

alertSchema.index({ guildId: 1, timestamp: -1 });

export default mongoose.model('Alert', alertSchema);
