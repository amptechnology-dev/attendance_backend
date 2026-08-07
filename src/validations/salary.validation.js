import yup from 'yup';
import { isValidObjectId } from 'mongoose';

export const salaryStructureSchema = yup.object().shape({
  grossSalary: yup
    .object()
    .shape({
      calculationType: yup.string().oneOf(['perDay', 'fixed'], 'Invalid gross salary calculation type').required(),
    })
    .required(),

  basicSalary: yup
    .object()
    .shape({
      calculationType: yup
        .string()
        .oneOf(['onGross', 'onTotalSalary'], 'Invalid basic salary calculation type')
        .required(),
      percentage: yup
        .number()
        .typeError('Basic percentage must be a number')
        .min(0)
        .max(100)
        .required('Basic salary percentage is required'),
    })
    .required(),

  da: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false),
      percentage: yup
        .number()
        .min(0)
        .max(100)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('DA percentage is required when DA is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
    })
    .required(),
  otherAllowance: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false),
      percentage: yup
        .number()
        .min(0)
        .max(100)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('Other Allowance percentage is required when enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
    })
    .required(),

  hra: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false),
      calculateOn: yup
        .string()
        .oneOf(['basic', 'gross', 'basicPlusDa'], 'Invalid HRA calculation base')
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('HRA calculation base is required when HRA is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
      percentage: yup
        .number()
        .min(0)
        .max(100)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('HRA percentage is required when HRA is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
    })
    .required(),

  conveyance: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false),
      mode: yup
        .string()
        .oneOf(['input', 'readonly'], 'Invalid conveyance mode')
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('Conveyance mode is required when Conveyance is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
      // percentage only matters when mode === 'readonly'
      percentage: yup
        .number()
        .min(0)
        .max(100)
        .when(['enabled', 'mode'], {
          is: (enabled, mode) => enabled === true && mode === 'readonly',
          then: (schema) => schema.required('Conveyance percentage is required for read-only mode'),
          otherwise: (schema) => schema.notRequired(),
        }),
    })
    .required(),

  specialAllowance: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false), // no percentage — always auto-calculated (residual)
    })
    .required(),

  pf: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false),
      calculateOn: yup
        .string()
        .oneOf(['basic', 'basicPlusDa'], 'Invalid PF calculation base')
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('PF calculation base is required when PF is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
      rate: yup
        .number()
        .min(0)
        .max(100)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('PF rate is required when PF is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
      wageCeiling: yup
        .number()
        .min(0)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('PF wage ceiling is required when PF is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
    })
    .required(),

  esi: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false),
      rate: yup
        .number()
        .min(0)
        .max(100)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('ESI rate is required when ESI is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
      wageCeiling: yup
        .number()
        .min(0)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('ESI wage ceiling is required when ESI is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
    })
    .required(),

  pTax: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false), // slab-based, no rate field needed
    })
    .required(),

  lwf: yup
    .object()
    .shape({
      enabled: yup.boolean().default(false),
      calculateOn: yup
        .string()
        .oneOf(['gross', 'basic', 'basicPlusDa', 'actualSalary'], 'Invalid LWF calculation base')
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('LWF calculation base is required when LWF is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
      wageCeiling: yup
        .number()
        .min(0)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('LWF wage ceiling is required when LWF is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
      fixedAmount: yup
        .number()
        .min(0)
        .when('enabled', {
          is: true,
          then: (schema) => schema.required('LWF fixed amount is required when LWF is enabled'),
          otherwise: (schema) => schema.notRequired(),
        }),
    })
    .required(),

  bonus_rate: yup.number().min(0).max(100).required('Bonus rate is required'),
});

export const updateAdvanceSalaryValidationSchema = yup
  .object()
  .shape({
    staffId: yup
      .string()
      .required('Staff ID is required')
      .test('is-mongo-id', 'Staff ID is not a valid Mongo ID', isValidObjectId),

    totalAmount: yup.number().positive('Amount must be positive'),
    remainingAmount: yup
      .number()
      .positive('Amount must be positive')
      .when('totalAmount', {
        is: (val) => val !== undefined && val !== null,
        then: (schema) => schema.max(yup.ref('totalAmount'), 'Remaining amount cannot be greater than total amount'),
      }),

    remainingMonths: yup.number().min(1, 'Remaining months must be at least 1'),

    remarks: yup.string(),

    startMonth: yup.number().min(1).max(12),
    startYear: yup.number().min(2000).max(2100),

    pauseMonth: yup
      .string()
      .matches(/^\d{4}-(0[1-9]|1[0-2])$/, 'pauseMonth must be in yyyy-MM format')
      .transform((value, originalValue) => (originalValue === '' ? undefined : value)),

    removePauseMonth: yup
      .string()
      .matches(/^\d{4}-(0[1-9]|1[0-2])$/, 'removePauseMonth must be in yyyy-MM format')
      .transform((value, originalValue) => (originalValue === '' ? undefined : value)),
  })

  .test(
    'amount-fields-together',
    'remainingAmount and remainingMonths must be provided together when updating advance amount',
    (obj) => {
      const hasRemainingAmount = obj.remainingAmount !== undefined && obj.remainingAmount !== null;
      const hasRemainingMonths = obj.remainingMonths !== undefined && obj.remainingMonths !== null;
      return hasRemainingAmount === hasRemainingMonths;
    }
  )
  .test(
    'at-least-one-action',
    'Provide at least one of: remainingAmount/remainingMonths, remarks, startMonth/startYear, pauseMonth, or removePauseMonth',
    (obj) =>
      obj.remainingAmount !== undefined ||
      obj.remainingMonths !== undefined ||
      obj.remarks !== undefined ||
      obj.startMonth !== undefined ||
      obj.pauseMonth !== undefined ||
      obj.removePauseMonth !== undefined
  );
