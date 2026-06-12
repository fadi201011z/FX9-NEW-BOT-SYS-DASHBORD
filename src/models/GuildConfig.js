import mongoose from 'mongoose';

const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  key: { type: String, required: true },
  value: String,
}, { timestamps: true });

guildConfigSchema.index({ guildId: 1, key: 1 }, { unique: true });

export default mongoose.model('GuildConfig', guildConfigSchema);
