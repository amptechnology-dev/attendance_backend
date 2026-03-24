import mongoose from 'mongoose';

const weekOffSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
      index: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      index: true,
    },
    forAllDepartments: {
      type: Boolean,
      default: false,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export const WeekOff = mongoose.model('WeekOff', weekOffSchema);
