import mongoose from 'mongoose';

const offDayWorkSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Office',
      required: true,
    },
    staff: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Staff',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    workType: { type: String, enum: ['full-day', 'half-day', 'hourly'], required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    benifit: {
      type: String,
      enum: ['extraPay', 'extraLeave', 'compOff'],
      default: 'extraPay',
    },
    remarks: { type: String },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    linkedDate: Date,
  },
  {
    timestamps: true,
  }
);

offDayWorkSchema.index({ staff: 1, date: 1 }, { unique: true });

export const OffDayWork = mongoose.model('OffDayWork', offDayWorkSchema);
