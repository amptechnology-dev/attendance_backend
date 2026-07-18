import mongoose from 'mongoose';

const attendanceCalculationSchema = new mongoose.Schema(
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

    locked: {
      type: Boolean,
      default: true,
    },

    calculatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
  },
  {
    timestamps: true,
  }
);

attendanceCalculationSchema.index(
  {
    office: 1,
    date: 1,
  },
  {
    unique: true,
  }
);

export const AttendanceCalculation = mongoose.model('AttendanceCalculation', attendanceCalculationSchema);
