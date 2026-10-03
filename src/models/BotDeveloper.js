import mongoose from 'mongoose';

// Bot developers are global, not per-guild. They get /dev and nothing else in
// the guild pages -- their power is on the bot, not on anyone's server.
const botDeveloperSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: String,
  avatar: String,
  note: String,
  addedBy: String,
  addedAt: { type: Number, default: Date.now },
}, { timestamps: true });

export default mongoose.model('BotDeveloper', botDeveloperSchema);