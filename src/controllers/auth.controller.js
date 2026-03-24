import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { generateAccessToken, generateRefreshToken } from '../utils/auth.utils.js';
import { Admin } from '../models/admin.model.js';
import { Staff } from '../models/staff.model.js';
import { Role } from '../models/role.model.js'; //TODO: Remove this later, when we import somewhere else
import { logUserLogin } from '../utils/loginLogger.js';
import { generateOtp } from '../utils/randomStringGenarator.js';
import axios from 'axios';
import { Office } from '../models/office.model.js';

export const adminLogin = expressAsyncHandler(async (req, res) => {
  const { username, password, otp } = req.body;
  if (!username) {
    throw new ApiError(400, 'username is required.');
  }

  const ip = req.ip;
  const userAgent = req.headers['user-agent'];
  const hostname = req.hostname;
  const requestUrl = req.originalUrl;

  let admin = await Admin.findOne({ username }).select('+password');
  let userType = 'admin';

  if (!admin) {
    admin = await Staff.findOne({ staffId: username, status: 'active' }).select('+password +role').populate('role');

    if (!admin || !admin.role?.adminAccess) {
      logUserLogin({
        office: admin?.office,
        username,
        userId: admin?._id,
        ip,
        hostname,
        userAgent,
        requestUrl,
        status: 'fail',
        authType: 'admin',
      });
      throw new ApiError(400, 'Invalid Credentials.');
    }
    userType = 'staff';
  }

  if (otp) {
    // Verify OTP
    if (!admin.otp || admin.otp != otp || admin.otpExpires < Date.now()) {
      logUserLogin({
        office: admin.office,
        username,
        userId: admin?._id,
        ip,
        hostname,
        userAgent,
        requestUrl,
        status: 'fail',
        authType: 'admin',
      });
      throw new ApiError(400, 'Invalid or expired OTP.');
    }

    // OTP valid → clear it and issue token
    admin.otp = null;
    admin.otpExpires = null;
    await admin.save();

    const accessToken = generateAccessToken(admin, 'admin', userType, '1d');
    const cookieOptions = {
      signed: true,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
    };
    res.cookie('accessToken', accessToken, cookieOptions);

    logUserLogin({
      office: admin.office,
      username,
      userId: admin?._id,
      ip,
      hostname,
      userAgent,
      requestUrl,
      status: 'success',
      authType: 'admin',
      role: admin?.role?.name || 'Admin',
    });
    return new ApiResponse(200, { username, accessToken, role: admin.role }, 'Admin logged in successfully.').send(res);
  }

  const isPasswordValid = admin.isPasswordCorrect ? await admin.isPasswordCorrect(password) : false;
  if (!isPasswordValid) {
    logUserLogin({
      office: admin.office,
      username,
      userId: admin?._id,
      ip,
      hostname,
      userAgent,
      requestUrl,
      status: 'fail',
      authType: 'admin',
    });
    throw new ApiError(400, 'Invalid Credentials.');
  }

  // Generate OTP and save
  const newOtp = Math.floor(100000 + Math.random() * 900000);
  admin.otp = newOtp;
  admin.otpExpires = Date.now() + 5 * 60 * 1000; // 5 min
  await admin.save();

  // Send OTP via SMS
  const message = `${newOtp} is your OTP to login into AMP Attendance. Please do not share this OTP with anyone.- AMPTECH`;
  const params = {
    username: 'MTECHTRANS',
    apikey: '38892-B2424',
    apirequest: 'Text',
    sender: 'AMPTCH',
    mobile: admin.mobile,
    message,
    route: 'TRANS',
    TemplateID: '1407172715834228636',
    format: 'JSON',
  };

  const smsResponse = await axios.get('http://text.mboxsolution.com/sms-panel/api/http/index.php', { params });
  await Office.updateOne({ _id: admin.office }, { $inc: { smsCount: 1 } });
  if (smsResponse.data.status !== 'success') {
    console.error('Failed to send SMS:', smsResponse.data);
    throw new ApiError(500, 'Failed to send SMS.', [{ message: 'Failed to send SMS' }]);
  }

  return new ApiResponse(200, { message: 'OTP sent to your mobile number.', username }).send(res);
});

export const adminLogout = expressAsyncHandler(async (req, res) => {
  res.clearCookie('accessToken');
  return new ApiResponse(200, null, 'Admin logged out successfully.').send(res);
});

export const staffLogin = expressAsyncHandler(async (req, res) => {
  const { staffId, password } = req.body;
  if (!staffId || !password) {
    throw new ApiError(400, 'staffId and password are required.');
  }

  // Data for logging
  const username = staffId;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];
  const hostname = req.hostname;
  const requestUrl = req.originalUrl;

  const staff = await Staff.findOne({ staffId }).select('+password').select('+role').populate('role');
  if (!staff || !(await staff.isPasswordCorrect(password))) {
    logUserLogin({
      username,
      userId: staff?._id,
      ip,
      hostname,
      userAgent,
      requestUrl,
      status: 'fail',
      authType: 'staff',
    });
    throw new ApiError(400, 'Invalid staffId or password.');
  }

  const accessToken = generateAccessToken(staff, 'staff');
  const refreshToken = generateRefreshToken(staff, 'staff');

  //Save refresh token in database
  staff.refreshToken = refreshToken;
  await staff.save();

  const cookieOptions = {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
  };
  res.cookie('accessToken', accessToken, cookieOptions);
  res.cookie('refreshToken', refreshToken, cookieOptions);
  logUserLogin({
    office: staff.office,
    username,
    userId: staff?._id,
    ip,
    hostname,
    userAgent,
    requestUrl,
    status: 'success',
    authType: 'staff',
    role: staff?.role?.name || '',
  });
  return new ApiResponse(200, { staffId, accessToken, refreshToken }, 'Staff logged in successfully.').send(res);
});

export const refreshStaffTokens = expressAsyncHandler(async (req, res) => {
  const refreshToken = req.signedCookies.refreshToken || req.body.refreshToken;
  if (!refreshToken) {
    throw new ApiError(400, 'Refresh token is required.');
  }
  const staff = await Staff.findOne({ refreshToken });
  if (!staff) {
    throw new ApiError(400, 'Invalid refresh token.');
  }
  const accessToken = generateAccessToken(staff, 'staff');
  const newRefreshToken = generateRefreshToken(staff, 'staff');
  staff.refreshToken = newRefreshToken;
  await staff.save();

  const cookieOptions = {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
  };
  res.cookie('accessToken', accessToken, cookieOptions);
  res.cookie('refreshToken', newRefreshToken, cookieOptions);

  return new ApiResponse(200, { accessToken, refreshToken }, 'Tokens refreshed successfully.').send(res);
});

export const sendOTPAtMobile = expressAsyncHandler(async (req, res) => {
  const { staffId, mobile } = req.body;
  const user = await Staff.findOne({ $or: [{ staffId }, { mobile }] });
  if (!user) throw new ApiError(404, 'User not found.', [{ message: 'User not found.' }]);

  const otp = generateOtp();
  const otpExpires = Date.now() + 15 * 60 * 1000;

  user.otp = otp;
  user.otpExpiry = otpExpires;
  await user.save();

  // Send OTP via SMS
  const message = `${otp} is your OTP to login into AMP. Please do not share this OTP with anyone.- AMPTECH`;
  const params = {
    username: 'MTECHTRANS',
    apikey: '38892-B2424',
    apirequest: 'Text',
    sender: 'AMPTCH',
    mobile: user.mobile,
    message,
    route: 'TRANS',
    TemplateID: '1407172715834228636',
    format: 'JSON',
  };

  const smsResponse = await axios.get('http://text.mboxsolution.com/sms-panel/api/http/index.php', { params });
  await Office.updateOne({ _id: user.office }, { $inc: { smsCount: 1 } });
  if (smsResponse.data.status !== 'success') {
    console.error('Failed to send SMS:', smsResponse.data);
    throw new ApiError(500, 'Failed to send SMS.', [{ message: 'Failed to send SMS' }]);
  }
  return new ApiResponse(200, { mobile: user.mobile }, 'OTP sent successfully.').send(res);
});

export const resetStaffPassword = expressAsyncHandler(async (req, res) => {
  const { mobile, otp, newPassword } = req.body;
  const user = await Staff.findOne({ mobile });
  if (!user || user.otp !== Number(otp) || user.otpExpiry < Date.now()) {
    throw new ApiError(400, 'Invalid or expired OTP.', [{ message: 'Invalid or expired OTP' }]);
  }

  user.password = newPassword;
  user.otp = undefined;
  user.otpExpiry = undefined;
  user.refreshToken = undefined;
  await user.save();
  user.password = undefined;
  return new ApiResponse(200, user, 'Password reset successfully.').send(res);
});

export const resetAdminPassword = expressAsyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const admin = await Admin.findById(req.admin?._id).select('+password');
  if (!admin) {
    throw new ApiError(404, 'Admin not found.', [{ message: 'You are not allowed to perform this action!' }]);
  }
  if (!(await admin.isPasswordCorrect(oldPassword))) {
    throw new ApiError(400, 'Invalid password.', [{ message: 'Invalid old password!' }]);
  }
  admin.password = newPassword;
  await admin.save();
  admin.password = undefined;
  res.clearCookie('accessToken');
  return new ApiResponse(200, admin, 'Password reset successfully.').send(res);
});
