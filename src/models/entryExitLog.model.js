import mongoose from 'mongoose';

const entryExitLogSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    slNo: {
      type: Number,
      required: true,
    },
    entryTime: {
      type: Date,
      default: null,
    },
    exitTime: {
      type: Date,
      default: null,
    },
    workingTime: {
      type: Number,
      default: 0,
    },
    deviceId: String,
    manual: { type: Boolean, default: false },
    remarks: String,
  },
  { timestamps: true }
);

entryExitLogSchema.index({ office: 1, date: -1, entryTime: -1 });

entryExitLogSchema.index({ staff: 1, date: 1, slNo: -1 });

export const EntryExitLog = mongoose.model('EntryExitLog', entryExitLogSchema);