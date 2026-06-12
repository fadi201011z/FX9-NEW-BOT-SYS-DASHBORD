import mongoose from 'mongoose';

const voiceChannelSchema = new mongoose.Schema({
  vcId: { type: String, required: true, unique: true },
  guildId: { type: String, required: true, index: true },
  channelId: String,
  ownerId: String,
  name: String,
  userLimit: Number,
  bitrate: Number,
  locked: { type: Boolean, default: false },
  hidden: { type: Boolean, default: false },
  createdAt: { type: Number, default: Date.now },
}, { timestamps: true });

voiceChannelSchema.index({ guildId: 1 });

export default mongoose.model('VoiceChannel', voiceChannelSchema);
