import mongoose from 'mongoose';

const monthSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    monthNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: true,
    },
    isCurrentMonth: {
      type: Boolean,
      default: false,
    },
    isPreviousMonth: {
      type: Boolean,
      default: false,
    },
    financialYear: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FinancialYear',
      required: true,
    },
  },
  { timestamps: true }
);

export const Month = mongoose.model('Month', monthSchema);
