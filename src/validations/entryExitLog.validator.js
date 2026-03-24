import yup from 'yup';

export const entryExitLogValidationSchema = yup.object().shape({
  staffId: yup.string().required('Staff ID is required'),
  timestamp: yup.date().required('Entry time is required'),
  deviceId: yup.string(),
  remarks: yup.string(),
});

export const manualEntryExitLogValidationSchema = yup.object().shape({
  staff_id: yup.string().required('Staff ID is required'),
  date: yup.date().required('Date is required'),
  entry_time: yup.date().required('Entry time is required'),
  exit_time: yup.date().required('Exit time is required'),
  remarks: yup.string(),
});

export const manualEntryLogValidationSchema = yup.object().shape({
  staff_id: yup.string().required('Staff ID is required'),
  date: yup.date().required('Date is required'),
  entry_time: yup.date().required('Entry time is required'),
  remarks: yup.string(),
});

export const manualExitLogValidationSchema = yup.object().shape({
  log_id: yup.string().required('Entry Log ID is required'),
  date: yup.date().required('Date is required'),
  exit_time: yup.date().required('Exit time is required'),
});

export const updateEntryLogValidationSchema = yup.object().shape({
  logId: yup.string().required('Log ID is required'),
  entryTime: yup.date().required(),
  remarks: yup.string(),
});
