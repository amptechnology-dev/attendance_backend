import mongoose from 'mongoose';

const HolidayFundSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
      index: true,
    },
    month: {
      type: Number, // 1-12
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

HolidayFundSchema.index({ office: 1, month: 1, year: 1, staff: 1 }, { unique: true });

export const HolidayFund = mongoose.model('HolidayFund', HolidayFundSchema);
