import mongoose from 'mongoose';

const officeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxLength: 12,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    gstin: {
      type: String,
      trim: true,
    },
    holidayFundBalance: {
      type: Number,
      default: 0,
    },
    otpSentCount: Number,
  },
  {
    timestamps: true,
  }
);

export const Office = mongoose.model('Office', officeSchema);
