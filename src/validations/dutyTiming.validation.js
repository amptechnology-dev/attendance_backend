import yup from 'yup';

export const dutyTimingValidationSchema = yup.object().shape({
  startTime: yup
    .string()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid startTime format')
    .optional(),
  entryTime: yup
    .string()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid entryTime format')
    .optional(),
  firstHalfEnd: yup
    .string()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid firstHalfEnd format')
    .optional(),
  secondHalfStart: yup
    .string()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid secondHalfStart format')
    .optional(),
  endTime: yup
    .string()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid endTime format')
    .optional(),
  lateEntryTime: yup.number().typeError('Late entry time must be a number').min(0).max(59).optional(),
  halfDayAllowed: yup.number().typeError('Half day allowed must be a number').min(0).max(10).optional(),
  lateAllowed: yup.number().typeError('Late Entry allowed must be a number').min(0).max(10).optional(),
  paidLeave: yup.number().typeError('Paid leaves must be a number').min(1).max(20).optional(),
});
