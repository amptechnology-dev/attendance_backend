import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
    },
    deviceName: String,
    deviceSn: {
      type: String,
      unique: true,
      required: true,
      sparse: true,
    },
    ip: String,
    pullDisabled: { type: Boolean, default: false },
    lastPulledAt: Date,
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const Device = mongoose.model('Device', deviceSchema);
