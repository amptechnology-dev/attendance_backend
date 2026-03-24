import mongoose from 'mongoose';

const SalarySchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    month: {
      type: Number, // 1-12
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    baseSalary: {
      type: Number, //  Staff's monthlySalary
      required: true,
    },
    totalPayableDays: {
      type: Number, // Calculated: total days of month
      required: true,
    },
    // totalWorkingDays: {
    //   type: Number, // Calculated: total days  - holidays - weekoffs in the month
    //   required: true,
    // },
    attendanceDetails: {
      totalFullDays: { type: Number, default: 0 },
      totalHalfDays: { type: Number, default: 0 },
      totalHourPay: { type: Number, default: 0 },
      overtimeHours: { type: Number, default: 0 },
    },
    leaves: {
      totalPaidLeaves: { type: Number, default: 0 },
      totalUnpaidLeaves: { type: Number, default: 0 },
      totalHolidayLeaves: { type: Number, default: 0 },
      leaveDeduction: { type: Number, default: 0 },
    },
    breakdown: {
      basic: { type: Number, required: true }, // % of baseSalary
      hra: { type: Number, required: true }, // % of baseSalary
      conveyance: { type: Number, required: true }, // % of baseSalary
      specialAllowance: { type: Number, default: 0 }, // Optional special allowance
      otherAllowance: { type: Number, default: 0 }, // Optional allowance
      esi: { type: Number, default: 0 }, // ESI deduction
      pf: { type: Number, default: 0 }, // PF deduction
      pTax: { type: Number, default: 0 }, // Professional Tax
      hourlyPay: { type: Number, default: 0 }, // Hourly pay
      bonus: { type: Number, default: 0 }, // Calculated bonus
      overtime: { type: Number, default: 0 }, // Calculated: overtime_hours * overtime_rate
      advanceDeduction: { type: Number, default: 0 }, // Deduction for advance salary
    },
    deductions: {
      type: Number,
      default: 0, // Any additional deductions
    },
    grossSalary: {
      type: Number, // Calculated: base_salary + overtime_pay + bonuses
      required: true,
    },
    netSalary: {
      type: Number, // Calculated: gross_salary - deductions
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'finalized', 'paid'],
      default: 'pending',
    },
    paymentDate: Date,
    transactionId: String,
  },
  {
    timestamps: true,
  }
);

const SalaryStructureShema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
    },
    basic_percentage: { type: Number, default: 50 },
    hra_allowance_percentage: { type: Number, default: 25 },
    conveyance_allowance_percentage: { type: Number, default: 10 },
    special_allowance_percentage: { type: Number, default: 5 },
    other_allowance_percentage: { type: Number, default: 10 },
    esi_rate: { type: Number, default: 0.75 },
    pf_rate: { type: Number, default: 12 },
    bonus_rate: { type: Number, default: 8.33 },
  },
  { timestamps: true }
);

const AdvanceTransactionSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    month: Number,
    year: Number,
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ['add', 'deduct', 'update'],
      required: true,
    },
    // Exclusive fields for 'update' only
    previousAmount: Number,
    newAmount: Number,
    previousMonths: Number,
    newMonths: Number,
    remarks: String,
  },
  {
    timestamps: true,
  }
);

SalarySchema.index({ office: 1, staff: 1, month: 1, year: 1 });
AdvanceTransactionSchema.index({ staff: 1, month: 1, year: 1 });

export const SalaryStructure = mongoose.model('SalaryStructure', SalaryStructureShema);
export const AdvanceTransaction = mongoose.model('AdvanceTransaction', AdvanceTransactionSchema);
export const Salary = mongoose.model('Salary', SalarySchema);
