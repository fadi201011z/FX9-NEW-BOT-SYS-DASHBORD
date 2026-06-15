import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  guildId:      { type: String, required: true, index: true },
  platform:     { type: String, required: true, enum: ['youtube', 'twitch', 'twitter'] },
  channelUrl:   { type: String, required: true },
  channelId:    { type: String, default: '' },
  channelName:  { type: String, default: '' },
  discordChannelId: { type: String, required: true },
  lastVideoId:  { type: String, default: '' },
  lastStreamStatus: { type: Boolean, default: false },
  customMessage: { type: String, default: '' },
  createdAt:    { type: Number, default: Date.now },
}, { timestamps: true });

notificationSchema.index({ guildId: 1, platform: 1 });

export default mongoose.model('Notifications', notificationSchema);
