import yup from 'yup';

const bankDetailsSchema = yup.object().shape({
  accountHolderName: yup.string().trim(),
  accountNumber: yup.string().trim(),
  bankName: yup.string().trim(),
  branchName: yup.string().trim(),
  ifscCode: yup.string().trim(),
  // .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
  micrCode: yup.string().trim(),
  // .matches(/^[0-9]{9}$/, 'Invalid MICR code'),
});

export const staffValidationSchema = yup
  .object()
  .shape({
    fullName: yup.string().required('Full Name is required'),
    designation: yup.string(),
    mobile: yup
      .string()
      .matches(/^[6-9]\d{9}$/, 'Invalid mobile number')
      .required('Mobile is required'),
    email: yup.string().email('Invalid email address'),
    gender: yup
      .string()
      .oneOf(['male', 'female'], 'Gender must be either "male" or "female"')
      .required('Gender is required'),
    dateOfBirth: yup
      .date()
      .max(new Date(), 'Date of birth cannot be in the future')
      .required('Date of birth is required'),
    dateOfJoining: yup.date().required('Date of joining is required'),
    address: yup.string().required('Address is required'),
    pfNo: yup.string(),
    esiNo: yup.string(),
    panNo: yup.string().trim(),
    // .matches(/[A-Z]{5}[0-9]{4}[A-Z]{1}/, 'Invalid PAN number format'),
    // .required('PAN number is required'),
    aadhaarNo: yup.string(),
    // .length(12, 'Aadhaar number must be 12 digits'),
    // .required('Aadhaar number is required'),
    monthlySalary: yup
      .number()
      .positive('Monthly salary must be a positive number')
      .required('Monthly salary is required'),
    overtimeRate: yup
      .number()
      .positive('Overtime rate must be a positive number')
      .required('Overtime rate is required'),
    allowedPaidLeaves: yup.number().positive('Remaining Paid Leaves must be a positive number').required(),
    bankDetails: bankDetailsSchema.test('all-or-none', 'Invalid bank details!', (value) => {
      if (!value) return true;
      const fields = Object.values(value).filter(Boolean);
      if (fields.length === 0) return true; // all empty → valid
      // if some filled, ensure all filled
      return (
        value.accountHolderName &&
        value.accountNumber &&
        value.bankName &&
        value.branchName &&
        value.ifscCode &&
        value.micrCode
      );
    }),
    advanceTotalAmount: yup
      .number()
      .typeError('Advance amount must be a number')
      .positive('Advance amount must be positive')
      .transform((value) => (isNaN(value) ? undefined : value)),
    advanceRemainingAmount: yup
      .number()
      .typeError('Remaining Amount must be a number')
      .positive('Amount must be positive')
      .transform((value) => (isNaN(value) ? undefined : value))
      .max(yup.ref('advanceTotalAmount'), 'Remaining amount cannot be greater than total amount'),
    advanceRemainingMonths: yup
      .number()
      .typeError('Remaining Months must be a number')
      .min(1, 'Remaining months must be at least 1')
      .transform((value) => (isNaN(value) ? undefined : value)),
    advanceRemarks: yup.string().optional(),
  })
  .test(
    'advance-salary-logic',
    'If advanceTotalAmount is provided, advanceRemainingMonths is required and must be valid',
    (values) => {
      if (values.advanceTotalAmount > 0) {
        if (!values.advanceRemainingAmount || values.advanceRemainingAmount <= 0) {
          return new yup.ValidationError(
            'Remaining Amount must be provided and greater than 0 if advance salary exists',
            null,
            'advanceRemainingAmount'
          );
        }

        if (!values.advanceRemainingMonths || values.advanceRemainingMonths <= 0) {
          return new yup.ValidationError(
            'Remaining Months must be provided and greater than 0 if advance salary exists',
            null,
            'advanceRemainingMonths'
          );
        }
      }
      return true;
    }
  );

export const updateStaffValidationSchema = yup.object().shape({
  fullName: yup.string().trim(),
  designation: yup.string().trim(),
  mobile: yup.string().matches(/^[0-9]{10}$/, 'Invalid mobile number'),
  email: yup.string().email('Invalid email address'),
  gender: yup.string().oneOf(['male', 'female'], 'Gender must be either "male" or "female"'),
  dateOfBirth: yup.date().max(new Date(), 'Date of birth cannot be in the future'),
  dateOfJoining: yup.date().max(new Date(), 'Date of joining cannot be in the future'),
  address: yup.string().trim(),
  pfNo: yup.string().trim(),
  esiNo: yup.string().trim(),
  panNo: yup.string().matches(/[A-Z]{5}[0-9]{4}[A-Z]{1}/, 'Invalid PAN number format'),
  aadhaarNo: yup.string().matches(/^[0-9]{12}$/, 'Aadhaar number must be 12 digits'),
  monthlySalary: yup.number().positive('Monthly salary must be a positive number'),
  overtimeRate: yup.number().positive('Overtime rate must be a positive number'),
  allowedPaidLeaves: yup.number().positive('Allowed paid leaves must be a positive number'),
});

export const changeStaffStatusSchema = yup.object().shape({
  status: yup.string().required('Status is required').oneOf(['active', 'inactive']),
});
