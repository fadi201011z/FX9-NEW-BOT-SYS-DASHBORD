import mongoose from 'mongoose';

const commandConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  commandName: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  allowedRoles: { type: [String], default: [] },
  blockedRoles: { type: [String], default: [] },
  allowedChannels: { type: [String], default: [] },
  blockedChannels: { type: [String], default: [] },
}, { timestamps: true });

commandConfigSchema.index({ guildId: 1, commandName: 1 }, { unique: true });

export default mongoose.model('CommandConfig', commandConfigSchema);
