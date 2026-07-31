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
      type: Number,
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
      basic: { type: Number, required: true },
      da: { type: Number, default: 0 },
      hra: { type: Number, default: 0 },
      conveyance: { type: Number, default: 0 },
      otherAllowance: { type: Number, default: 0 },
      specialAllowance: { type: Number, default: 0 },
      esi: { type: Number, default: 0 },
      pf: { type: Number, default: 0 },
      pTax: { type: Number, default: 0 },
      hourlyPay: { type: Number, default: 0 },
      bonus: { type: Number, default: 0 },
      overtime: { type: Number, default: 0 },
      advanceDeduction: { type: Number, default: 0 },
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
    manualConveyance: {
      type: Number,
      default: 0,
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
      unique: true, // one structure per office
    },

    grossSalary: {
      calculationType: {
        type: String,
        enum: ['perDay', 'fixed'], // perDay = days*rate, fixed = staff.monthlySalary as-is
        default: 'fixed',
      },
    },

    basicSalary: {
      calculationType: {
        type: String,
        enum: ['perDay', 'fixed'],
        default: 'fixed',
      },
      percentage: { type: Number, default: 50, min: 0, max: 100 },
    },

    da: {
      enabled: { type: Boolean, default: false },
      percentage: { type: Number, default: 0, min: 0, max: 100 }, // % of Basic
    },

    hra: {
      enabled: { type: Boolean, default: false },
      calculateOn: {
        type: String,
        enum: ['basic', 'gross', 'basicPlusDa'],
        default: 'basic',
      },
      percentage: { type: Number, default: 0, min: 0, max: 100 },
    },

    conveyance: {
      enabled: { type: Boolean, default: false },
      mode: {
        type: String,
        enum: ['input', 'readonly'], // input = manual value/month, readonly = % auto-calculated
        default: 'input',
      },
      percentage: { type: Number, default: 0, min: 0, max: 100 }, // used only when mode === 'readonly'
    },

    specialAllowance: {
      enabled: { type: Boolean, default: false },
    },

    otherAllowance: {
      enabled: { type: Boolean, default: false },
      percentage: { type: Number, default: 0, min: 0, max: 100 }, 
    },

    pf: {
      enabled: { type: Boolean, default: false },
      calculateOn: {
        type: String,
        enum: ['basic', 'basicPlusDa'],
        default: 'basic',
      },
      rate: { type: Number, default: 12 },
      wageCeiling: { type: Number, default: 15000 },
    },

    esi: {
      enabled: { type: Boolean, default: false },
      rate: { type: Number, default: 0.75 },
      wageCeiling: { type: Number, default: 21000 },
    },

    pTax: {
      enabled: { type: Boolean, default: false },
    },

    bonus_rate: { type: Number, default: 8.33 }, // retained, still unused in calc (TODO from your original code)
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
