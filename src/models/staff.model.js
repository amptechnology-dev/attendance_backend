import mongoose, { set } from 'mongoose';
import bcrypt from 'bcrypt';
import voca from 'voca';

const staffSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      set: (v) => voca.titleCase(v),
    },
    staffId: String,
    designation: String,
    mobile: {
      type: String,
      match: /^[6-9]\d{9}$/,
      required: true,
      unique: true,
      trim: true,
      maxLength: 10,
    },
    email: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
      sparse: true,
    },
    gender: {
      type: String,
      enum: ['male', 'female'],
      required: true,
    },
    dateOfBirth: {
      type: Date,
      required: true,
    },
    dateOfJoining: {
      type: Date,
      required: true,
    },
    dateOfLeaving: {
      type: Date,
    },
    address: {
      type: String,
      required: true,
    },
    pfNo: {
      type: String,
      unique: true,
      sparse: true,
    },
    esiNo: {
      type: String,
      unique: true,
      sparse: true,
    },
    panNo: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    aadhaarNo: {
      type: Number,
      unique: true,
      sparse: true,
      default: null,
    },
    monthlySalary: Number,
    overtimeRate: Number,
    advanceSalary: {
      totalAmount: Number,
      remainingAmount: Number,
      remainingMonths: Number,
      monthlyDeduction: Number,
      remarks: String,
      pauseTill: Date,
    },
    allowedPaidLeaves: {
      type: Number,
      min: 0,
    },
    bankDetails: {
      accountHolderName: {
        type: String,
        trim: true,
      },
      accountNumber: {
        type: String,
        unique: true,
        sparse: true,
      },
      bankName: {
        type: String,
        trim: true,
      },
      branchName: {
        type: String,
        trim: true,
      },
      ifscCode: {
        type: String,
        match: /^[A-Z]{4}0[A-Z0-9]{6}$/, // standard IFSC format
      },
      micrCode: {
        type: String,
        match: /^[0-9]{9}$/, // standard MICR format
      },
    },
    password: {
      type: String,
      required: true,
      trim: true,
      select: false,
    },
    refreshToken: {
      type: String,
      select: false,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      select: false,
    },
    photo: String,
    otp: Number,
    otpExpiry: Date,
  },
  {
    timestamps: true,
  }
);

staffSchema.index({ office: 1, staffId: 1 }, { unique: true, sparse: true });

staffSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, 11);
  next();
});

staffSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password);
};

export const Staff = mongoose.model('Staff', staffSchema);
