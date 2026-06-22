import mongoose from 'mongoose';

const maintenanceSchema = new mongoose.Schema({
  enabled:  { type: Boolean, default: false },
  endTime:  { type: Number, default: null },
  durationMinutes: { type: Number, default: 0 },
  message:  { type: String, default: 'الموقع تحت الصيانة حالياً. سنعود قريباً!' },
  channelId:{ type: String, default: '' },
  updatedAt:{ type: Number, default: Date.now },
  updatedBy:{ type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Maintenance', maintenanceSchema);
