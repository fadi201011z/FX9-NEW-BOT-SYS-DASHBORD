import mongoose from 'mongoose';

const guildAdminRoleSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  roleId: { type: String, required: true },
  level: { type: String, default: 'moderator' },
  addedBy: String,
  addedAt: { type: Number, default: Date.now },
}, { timestamps: true });

guildAdminRoleSchema.index({ guildId: 1, roleId: 1 }, { unique: true });

export default mongoose.model('GuildAdminRole', guildAdminRoleSchema);
