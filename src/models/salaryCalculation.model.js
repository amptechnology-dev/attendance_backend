import mongoose from 'mongoose';

const salaryCalculationSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
      index: true,
    },

    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      index: true,
    },

    year: {
      type: Number,
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

salaryCalculationSchema.index(
  {
    office: 1,
    month: 1,
    year: 1,
  },
  {
    unique: true,
  }
);

export const SalaryCalculation = mongoose.model(
  'SalaryCalculation',
  salaryCalculationSchema
);