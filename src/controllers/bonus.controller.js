import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import {
  getBonusSettingMonths,
  getBonusRegister,
  saveManualBonusEntries,
  getManualBonusRangeStaff,
  generateBonusRegisterPdf,
  generateBonusRegisterWithoutSigPdf,
  generateBonusRegisterExcel,
} from '../services/bonus.service.js';

export const getBonusSettingMonthsList = expressAsyncHandler(async (req, res) => {
  const months = await getBonusSettingMonths(req.admin.office);
  return new ApiResponse(200, months, 'Bonus setting months fetched successfully.').send(res);
});

export const getBonusRegisterByMonth = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    throw new ApiError(400, 'Bad Request', 'month and year are required.');
  }
  const data = await getBonusRegister(req.admin.office, parseInt(month), parseInt(year));
  return new ApiResponse(200, data, 'Bonus register fetched successfully.').send(res);
});

export const getManualBonusStaffListHandler = expressAsyncHandler(async (req, res) => {
  const { month, year, backMonths, minTenureMonths } = req.query;
  if (!month || !year || !backMonths) {
    throw new ApiError(400, 'Bad Request', 'month, year and backMonths are required.');
  }
  const data = await getManualBonusRangeStaff(
    req.admin.office,
    parseInt(month),
    parseInt(year),
    parseInt(backMonths),
    minTenureMonths ? parseInt(minTenureMonths) : 0
  );
  return new ApiResponse(200, data, 'Eligible staff list fetched successfully.').send(res);
});

export const saveManualBonus = expressAsyncHandler(async (req, res) => {
  const { month, year, backMonths, minTenureMonths, entries } = req.body;
  const data = await saveManualBonusEntries(
    req.admin.office,
    month,
    year,
    backMonths,
    minTenureMonths,
    entries
  );
  return new ApiResponse(200, data, 'Bonus saved successfully.').send(res);
});

export const getBonusRegisterPdf = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.body;
  const pdfBuffer = await generateBonusRegisterPdf(req.admin.office, parseInt(month), parseInt(year));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="bonus_register_${month}_${year}.pdf"`);
  res.send(Buffer.from(pdfBuffer));
});

export const getBonusRegisterPdfWithoutSignature = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.body;
  const pdfBuffer = await generateBonusRegisterWithoutSigPdf(req.admin.office, parseInt(month), parseInt(year));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="bonus_register_${month}_${year}.pdf"`);
  res.send(Buffer.from(pdfBuffer));
});

export const getBonusRegisterExcel = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.body;
  const excelBuffer = await generateBonusRegisterExcel(req.admin.office, parseInt(month), parseInt(year));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bonus_register_${month}_${year}.xlsx"`);
  res.send(Buffer.from(excelBuffer));
});