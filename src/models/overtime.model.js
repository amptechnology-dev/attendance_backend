import mongoose from 'mongoose';

const OvertimeEntrySchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, 
    slots: { type: Number, required: true, min: 0 },
    source: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  },
  { _id: false }
);

const OvertimeSchema = new mongoose.Schema(
  {
    office: { type: mongoose.Schema.Types.ObjectId, ref: 'Office', required: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    entries: [OvertimeEntrySchema],
    totalSlots: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    slotMinutes: Number, 
    multiplier: Number,
    appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    appliedAt: Date,
  },
  { timestamps: true }
);

OvertimeSchema.index({ office: 1, staff: 1, month: 1, year: 1 }, { unique: true });

export const Overtime = mongoose.model('Overtime', OvertimeSchema);