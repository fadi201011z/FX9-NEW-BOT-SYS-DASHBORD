import mongoose from 'mongoose';

const maintenanceSchema = new mongoose.Schema({
  enabled:  { type: Boolean, default: false },
  endTime:  { type: Number, default: null },
  message:  { type: String, default: 'الموقع تحت الصيانة حالياً. سنعود قريباً!' },
  updatedAt:{ type: Number, default: Date.now },
  updatedBy:{ type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Maintenance', maintenanceSchema);
