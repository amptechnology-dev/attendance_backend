import yup from 'yup';
import { isValidObjectId } from 'mongoose';

export const leaveApplicationValidationSchema = yup.object().shape({
  staff: yup.string().test('is-mongo-id', 'Staff ID is not a valid Mongo ID', function (value) {
    if (!value) return true;
    return isValidObjectId(value);
  }),
  dateFrom: yup.date().required('From date is required').typeError('From date must be a valid date'),
  dateTo: yup
    .date()
    .required('End date is required')
    .min(yup.ref('dateFrom'), 'To date must be greater than from date')
    .typeError('To date must be a valid date'),
  type: yup.string().required('Leave type is required').oneOf(['sick', 'casual', 'holidayLeave'], 'Invalid leave type'),
  reason: yup.string().required('Reason is required').trim(),
  remarks: yup.string(),
});
