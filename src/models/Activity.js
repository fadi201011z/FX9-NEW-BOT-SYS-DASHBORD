import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  guildId: { type: String, index: true },
  action: { type: String, required: true },
  target: String,
  details: String,
  ipAddress: String,
  sessionId: String,
  timestamp: { type: Number, default: Date.now },
}, { timestamps: true });

activitySchema.index({ guildId: 1, timestamp: -1 });

export default mongoose.model('Activity', activitySchema);
