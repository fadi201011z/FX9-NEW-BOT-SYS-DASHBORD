import mongoose from 'mongoose';

const backupSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  filename: { type: String, required: true },
  size: Number,
  createdAt: { type: Number, default: Date.now },
  includes: { type: Object, default: {} },
  data: { type: mongoose.Schema.Types.Mixed }, // Store backup data in DB for serverless
}, { timestamps: true });

backupSchema.index({ guildId: 1, createdAt: -1 });

export default mongoose.model('Backup', backupSchema);
