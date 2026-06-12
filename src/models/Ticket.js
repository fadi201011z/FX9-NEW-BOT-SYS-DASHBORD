import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  guildId: { type: String, required: true, index: true },
  userId: { type: String, index: true },
  channelId: String,
  channelName: String,
  adminChannelId: String,
  username: String,
  category: String,
  title: String,
  description: String,
  evidence: String,
  priority: { type: String, default: 'medium' },
  status: { type: String, default: 'open' },
  openedAt: { type: Number, default: Date.now },
  createdAt: { type: Number, default: Date.now },
  closedAt: Number,
  closedBy: String,
  claimedBy: String,
  claimedByUsername: String,
  lastActivity: Number,
  inactivityWarned: { type: Boolean, default: false },
  rating: Number,
  ratedBy: String,
}, { timestamps: true });

ticketSchema.index({ guildId: 1, status: 1 });

export default mongoose.model('Ticket', ticketSchema);
