import * as yup from 'yup';

export const monthYearSchema = yup.object().shape({
  month: yup.number().typeError('Month must be a number.').required().integer().min(1).max(12),
  year: yup.number().typeError('Year must be a number.').required().integer().min(1999).max(2999),
});
