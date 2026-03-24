import yup from 'yup';

export const monthValidationSchema = yup.object().shape({
  startDate: yup.date().required('Start date is required'),
  endDate: yup.date().required('End date is required'),
  monthNumber: yup.number().required('Month number is required').min(1).max(12),
  year: yup.number().required('Year is required'),
});

export const updateMonthValidationSchema = yup.object().shape({
  startDate: yup.date(),
  endDate: yup.date(),
  monthNumber: yup.number().min(1).max(12),
  year: yup.number(),
});
