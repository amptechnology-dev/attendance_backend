import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
      index: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      index: true,
    },
    dateFrom: {
      type: Date,
      required: true,
      index: true,
    },
    dateTo: {
      type: Date,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['sick', 'casual', 'holidayLeave'], // Extend as needed
      required: true,
    },
    noOfDays: {
      type: Number,
      required: true,
    },
    reason: String,
    document: String,
    status: {
      type: String,
      enum: ['applied', 'approved', 'rejected'],
      default: 'applied',
      index: true,
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    remarks: String,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
  },
  { timestamps: true }
);

export const Leave = mongoose.model('Leave', leaveSchema);
