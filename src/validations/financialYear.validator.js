import yup from 'yup';

export const financialYearValidationSchema = yup.object().shape({
  startDate: yup.date().required('Start date is required'),
  endDate: yup.date().required('End date is required'),
  yearLabel: yup
    .string()
    .required('Year label is required')
    .matches(/^\d{4}-\d{4}$/, 'Invalid year label format. Expected format: YYYY-YYYY'),
});

export const updateFinancialYearSchema = yup.object().shape({
  startDate: yup.date(),
  endDate: yup.date(),
  yearLabel: yup.string().matches(/^\d{4}-\d{4}$/, 'Invalid year label format. Expected format: YYYY-YYYY'),
});
