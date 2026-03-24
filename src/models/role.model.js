import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  permissions: [String],
  active: { type: Boolean, default: true },
  adminAccess: { type: Boolean, default: false },
});

export const Role = mongoose.model('Role', roleSchema);
