import mongoose from 'mongoose';

const ticketGuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  ticketCategoryId: { type: String, default: '' },
  adminCategoryId: { type: String, default: '' },
  panelChannelId: { type: String, default: '' },
  logChannelId: { type: String, default: '' },
  supportRoleIds: { type: [String], default: [] },
  ticketCounter: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('TicketGuildConfig', ticketGuildConfigSchema);
