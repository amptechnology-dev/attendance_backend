import yup from 'yup';

export const holidayValidationSchema = yup.object().shape({
  name: yup.string().required('Name is required').trim(),
  date: yup.date().required('Date is required'),
  forAllDepartments: yup.boolean(),
  notes: yup.string(),
});
