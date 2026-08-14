import mongoose from 'mongoose';

const entryExitLogSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      index: true,
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

export const EntryExitLog = mongoose.model('EntryExitLog', entryExitLogSchema);
