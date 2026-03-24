import yup from 'yup';
import { isValidObjectId } from 'mongoose';

export const salaryStructureSchema = yup
  .object()
  .shape({
    basic_percentage: yup.number().min(0).max(100),
    hra_allowance_percentage: yup.number().min(0).max(100),
    conveyance_allowance_percentage: yup.number().min(0).max(100),
    special_allowance_percentage: yup.number().min(0).max(100),
    other_allowance_percentage: yup.number().min(0).max(100),
    esi_rate: yup.number().min(0).max(100),
    pf_rate: yup.number().min(0).max(100),
    bonus_rate: yup.number().min(0).max(100),
  })
  .test('sum-of-allowances', 'Total of all allowance must equal 100%', (value) => {
    const totalAllowance =
      value.basic_percentage +
      value.hra_allowance_percentage +
      value.conveyance_allowance_percentage +
      value.special_allowance_percentage +
      value.other_allowance_percentage;

    // If the sum of all allowances is not equal to 100, return error
    return totalAllowance == 100;
  });

export const updateAdvanceSalaryValidationSchema = yup.object().shape({
  staffId: yup.string().test('is-mongo-id', 'Staff ID is not a valid Mongo ID', isValidObjectId),
  totalAmount: yup.number().positive('Amount must be positive').required(),
  remainingAmount: yup
    .number()
    .positive('Amount must be positive')
    .required()
    .max(yup.ref('totalAmount'), 'Remaining amount cannot be greater than total amount'),
  remainingMonths: yup.number().required().min(1, 'Remaining months must be at least 1'),
  remarks: yup.string(),
  pauseTill: yup.date().transform((value, originalValue) => (originalValue === '' ? undefined : value)),
});
