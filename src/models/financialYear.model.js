import mongoose from 'mongoose';

const financialYearSchema = new mongoose.Schema({
  office: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Office',
    required: true,
  },
  yearLabel: {
    type: String,
    required: true, // e.g., "2024-2025"
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false, // Set to true for the current financial year
  },
});

export const FinancialYear = mongoose.model('FinancialYear', financialYearSchema);
