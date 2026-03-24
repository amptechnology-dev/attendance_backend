import mongoose from 'mongoose';

const AttendanceSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
      index: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['present', 'full-day', 'half-day', 'absent', 'holiday', 'week-off'],
      required: true,
    },
    firstHalf: {
      type: String,
      enum: ['present', 'absent'],
      default: 'absent',
    },
    secondHalf: {
      type: String,
      enum: ['present', 'absent'],
      default: 'absent',
    },
    breakTime: {
      type: Number, // Store total break time in minutes
      default: 0,
    },
    logs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EntryExitLog',
        required: true,
      },
    ],
    isLate: {
      type: Boolean,
      default: false,
    },
    allowedLate: {
      type: Boolean,
      default: false,
    },
    hrAdjustments: {
      adjustments: {
        type: String,
        enum: ['None', 'Half-day to Full-day', 'Present to Half-day', 'Hourly'],
        default: 'None',
      },
      adjustedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
      },
    },
    totalWorkTime: {
      type: Number, // Store total worked time in minutes
      default: 0,
    },
    leaveStatus: {
      type: String,
      enum: ['paid', 'unpaid'],
      default: null, // null means not applied
    },
    isOffDayWork: { type: Boolean, default: false },
    offDayAssignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'OffDayWork' },
    validOffDayWork: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AttendanceSchema.index({ office: 1, staffId: 1, date: 1 }, { unique: true });

AttendanceSchema.pre('save', function (next) {
  if (this.finalized) {
    return next(new Error('Cannot modify finalized attendance record.'));
  }
  next();
});

export const Attendance = mongoose.model('Attendance', AttendanceSchema);
