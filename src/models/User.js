import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: String,
  avatar: String,
  lastLogin: { type: Number, default: Date.now },
  role: { type: String, default: 'member' },
  permissions: { type: Object, default: {} },
  settings: { type: Object, default: { theme: 'dark' } },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
