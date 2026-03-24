import mongoose from 'mongoose';

// Regular expression to validate time in "HH:mm" format (24-hour clock)
const timeFormatRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const dutyTimingSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
    },
    startTime: {
      type: String,
      required: true,
      match: [timeFormatRegex, '{VALUE} is not a valid time. Use "HH:mm" format.'],
    },
    entryTime: {
      type: String,
      required: true,
      match: [timeFormatRegex, '{VALUE} is not a valid time. Use "HH:mm" format.'],
    },
    firstHalfEnd: {
      type: String,
      required: true,
      match: [timeFormatRegex, '{VALUE} is not a valid time. Use "HH:mm" format.'],
    },
    secondHalfStart: {
      type: String,
      required: true,
      match: [timeFormatRegex, '{VALUE} is not a valid time. Use "HH:mm" format.'],
    },
    endTime: {
      type: String,
      required: true,
      match: [timeFormatRegex, '{VALUE} is not a valid time. Use "HH:mm" format.'],
    },
    halfDayAllowed: Number,
    lateAllowed: Number,
    lateEntryTime: Number, // in minutes
    paidLeave: Number,
  },
  {
    timestamps: true,
  }
);

dutyTimingSchema.index({ office: 1, department: 1 }, { unique: true });

export const DutyTiming = mongoose.model('DutyTiming', dutyTimingSchema);
