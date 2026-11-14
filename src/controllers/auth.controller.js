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
import { SuperAdmin } from '../models/superAdmin.model.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const MAX_OTP_ATTEMPTS = 5;

const getCookieOptions = () => ({
  signed: true,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
});

const sendOtpSms = async (mobile, otp) => {
  const message = `${otp} is your OTP to login into AMP Attendance. Please do not share this OTP with anyone.- AMPTECH`;
  const params = {
    username: 'MTECHTRANS',
    apikey: '38892-B2424',
    apirequest: 'Text',
    sender: 'AMPTCH',
    mobile,
    message,
    route: 'TRANS',
    TemplateID: '1407172715834228636',
    format: 'JSON',
  };

  const smsResponse = await axios.get('http://text.mboxsolution.com/sms-panel/api/http/index.php', {
    params,
    timeout: 10000,
  });

  if (smsResponse.data?.status !== 'success') {
    console.error('Failed to send SMS:', smsResponse.data);
    throw new ApiError(500, 'Failed to send SMS.', [{ message: 'Failed to send SMS' }]);
  }
};

export const superAdminLogin = expressAsyncHandler(async (req, res) => {
  const { username, password, otp } = req.body;
  if (!username) {
    throw new ApiError(400, 'username is required.');
  }

  const ip = req.ip;
  const userAgent = req.headers['user-agent'];
  const hostname = req.hostname;
  const requestUrl = req.originalUrl;

  const logBase = { username, ip, hostname, userAgent, requestUrl, authType: 'superadmin' };

  const superAdmin = await SuperAdmin.findOne({ username }).select(
    '+password +otp +otpExpires +otpAttempts'
  );

  // ---------- STEP 2: OTP verify ----------
  if (otp) {
    const valid =
      superAdmin &&
      superAdmin.otp &&
      superAdmin.otpExpires > Date.now() &&
      superAdmin.otpAttempts < MAX_OTP_ATTEMPTS;

    if (!valid) {
      if (superAdmin?.otp) {
        superAdmin.otpAttempts += 1;
        await superAdmin.save();
      }
      logUserLogin({ ...logBase, userId: superAdmin?._id, status: 'fail' });
      throw new ApiError(400, 'Invalid or expired OTP.');
    }

    // timing-safe compare
    const a = Buffer.from(String(superAdmin.otp));
    const b = Buffer.from(String(otp));
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!match) {
      superAdmin.otpAttempts += 1;
      await superAdmin.save();
      logUserLogin({ ...logBase, userId: superAdmin._id, status: 'fail' });
      throw new ApiError(400, 'Invalid or expired OTP.');
    }

    // OTP valid -> clear and issue token
    superAdmin.otp = undefined;
    superAdmin.otpExpires = undefined;
    superAdmin.otpAttempts = 0;
    await superAdmin.save();

    const accessToken = generateAccessToken(superAdmin, 'superadmin', 'superadmin', '1d');
    res.cookie('accessToken', accessToken, getCookieOptions());

    logUserLogin({ ...logBase, userId: superAdmin._id, status: 'success', role: 'Super Admin' });

    return new ApiResponse(
      200,
      { username, accessToken, type: 'superadmin' },
      'Super admin logged in successfully.'
    ).send(res);
  }

  // ---------- STEP 1: password verify + OTP send ----------
  if (!password) {
    throw new ApiError(400, 'password is required.');
  }

  const isPasswordValid = superAdmin ? await superAdmin.isPasswordCorrect(password) : false;
  if (!isPasswordValid) {
    logUserLogin({ ...logBase, userId: superAdmin?._id, status: 'fail' });
    throw new ApiError(400, 'Invalid Credentials.');
  }

  if (!superAdmin.mobile) {
    throw new ApiError(400, 'Mobile number is not configured for this account.');
  }

  const newOtp = crypto.randomInt(100000, 1000000).toString();
  superAdmin.otp = newOtp;
  superAdmin.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
  superAdmin.otpAttempts = 0;
  await superAdmin.save();

  await sendOtpSms(superAdmin.mobile, newOtp);

  return new ApiResponse(
    200,
    { message: 'OTP sent to your mobile number.', username },
    'OTP sent successfully.'
  ).send(res);
});

export const superAdminLogout = expressAsyncHandler(async (req, res) => {
  res.clearCookie('accessToken');
  return new ApiResponse(200, null, 'Super admin logged out successfully.').send(res);
});

export const getAllOffices = expressAsyncHandler(async (req, res) => {
  const offices = await Office.find().select('name');
  return new ApiResponse(200, offices, 'Offices retrieved successfully.').send(res);
});

export const registerAdmin = expressAsyncHandler(async (req, res) => {
  const { office, username, password, mobile } = req.body;

  if (!office || !username || !password || !mobile) {
    throw new ApiError(400, 'office, username, password and mobile are required.');
  }

  const officeExists = await Office.findById(office);
  if (!officeExists) {
    throw new ApiError(404, 'Office not found.');
  }

  const existingUsername = await Admin.findOne({ username });
  if (existingUsername) {
    throw new ApiError(400, 'Username already exists.');
  }

  const existingMobile = await Admin.findOne({ mobile });
  if (existingMobile) {
    throw new ApiError(400, 'Mobile number already exists.');
  }

  const admin = await Admin.create({
    office,
    username,
    password,
    mobile,
  });

  const createdAdmin = await Admin.findById(admin._id).select('-password');

  return new ApiResponse(
    201,
    createdAdmin,
    'Admin registered successfully.'
  ).send(res);
});

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

// ================= FORGOT PASSWORD (admin + superadmin) =================
const RESET_OTP_TTL = 5 * 60 * 1000;
const RESEND_COOLDOWN = 60 * 1000;
const MOBILE_REGEX = /^[6-9]\d{9}$/;
const RESET_MODELS = { admin: Admin, superadmin: SuperAdmin };

// token single-use korar jonno: password change hole fingerprint badle jabe
const pwFingerprint = (hash) =>
  crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16);

// username + mobile + type validate (string check NoSQL injection thekeo bachay)
const validateIdentity = ({ username, mobile, type }) => {
  if (typeof type !== 'string' || !Object.hasOwn(RESET_MODELS, type)) {
    throw new ApiError(400, 'Invalid account type.');
  }
  if (typeof username !== 'string' || !username.trim() || username.trim().length > 50) {
    throw new ApiError(400, 'Enter a valid username.');
  }
  if (!MOBILE_REGEX.test(String(mobile || ''))) {
    throw new ApiError(400, 'Enter a valid 10-digit mobile number.');
  }
  return { username: username.trim(), mobile: String(mobile), type };
};

// username AND mobile duitai match korte hobe
const findResetAccount = ({ username, mobile, type }) =>
  RESET_MODELS[type]
    .findOne({ username, mobile })
    .select('+password +otp +otpExpires +otpAttempts');

// STEP 1: send OTP
export const forgotPasswordSendOtp = expressAsyncHandler(async (req, res) => {
  const identity = validateIdentity(req.body);
  const { username, mobile, type } = identity;

  const account = await findResetAccount(identity);

  if (account) {
    // resend cooldown (otpExpires - TTL = last sent time)
    if (account.otpExpires) {
      const sentAt = account.otpExpires.getTime() - RESET_OTP_TTL;
      if (Date.now() - sentAt < RESEND_COOLDOWN) {
        throw new ApiError(429, 'Please wait a minute before requesting another OTP.');
      }
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    account.otp = otp;
    account.otpExpires = new Date(Date.now() + RESET_OTP_TTL);
    account.otpAttempts = 0;
    await account.save();

    await sendOtpSms(account.mobile, otp);

    if (type === 'admin') {
      await Office.updateOne({ _id: account.office }, { $inc: { smsCount: 1 } });
    }
  }

  // account na thakleo same response (user enumeration rokhe)
  return new ApiResponse(
    200,
    { mobile, username },
    'If the details are correct, an OTP has been sent.'
  ).send(res);
});

// STEP 2: verify OTP -> resetToken
export const forgotPasswordVerifyOtp = expressAsyncHandler(async (req, res) => {
  const identity = validateIdentity(req.body);
  const { otp } = req.body;
  const { type } = identity;

  if (!/^\d{6}$/.test(String(otp || ''))) {
    throw new ApiError(400, 'A valid 6-digit otp is required.');
  }

  const account = await findResetAccount(identity);

  const attempts = account?.otpAttempts || 0;
  if (
    !account ||
    !account.otp ||
    !account.otpExpires ||
    account.otpExpires < Date.now() ||
    attempts >= MAX_OTP_ATTEMPTS
  ) {
    throw new ApiError(400, 'Invalid or expired OTP.');
  }

  const a = Buffer.from(String(account.otp));
  const b = Buffer.from(String(otp));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    account.otpAttempts = attempts + 1;
    await account.save();
    throw new ApiError(400, 'Invalid or expired OTP.');
  }

  // OTP valid -> clear
  account.otp = undefined;
  account.otpExpires = undefined;
  account.otpAttempts = 0;
  await account.save();

  const resetToken = jwt.sign(
    {
      _id: account._id,
      type: 'password-reset', // auth middleware-e ei type pass korbe na
      model: type,
      pf: pwFingerprint(account.password),
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '10m' }
  );

  return new ApiResponse(200, { resetToken }, 'OTP verified successfully.').send(res);
});

// STEP 3: set new password (token-e already specific account er _id ache)
export const forgotPasswordReset = expressAsyncHandler(async (req, res) => {
  const { resetToken, newPassword, confirmPassword } = req.body;

  if (!resetToken || !newPassword || !confirmPassword) {
    throw new ApiError(400, 'resetToken, newPassword and confirmPassword are required.');
  }
  if (newPassword !== confirmPassword) {
    throw new ApiError(400, 'Passwords do not match.');
  }
  if (newPassword.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters.');
  }

  const expired = () => new ApiError(400, 'Reset session expired. Please start again.');

  let decoded;
  try {
    decoded = jwt.verify(resetToken, process.env.ACCESS_TOKEN_SECRET);
  } catch {
    throw expired();
  }
  if (decoded.type !== 'password-reset' || !Object.hasOwn(RESET_MODELS, decoded.model)) {
    throw expired();
  }

  const account = await RESET_MODELS[decoded.model].findById(decoded._id).select('+password');
  if (!account || pwFingerprint(account.password) !== decoded.pf) throw expired();

  account.password = newPassword; // pre-save hook hash korbe
  await account.save();

  // ---------- Auto login: same token jeta normal login e dey ----------
  const isSuperAdmin = decoded.model === 'superadmin';
  const authType = isSuperAdmin ? 'superadmin' : 'admin';

  const accessToken = generateAccessToken(account, authType, authType, '1d');
  res.cookie('accessToken', accessToken, getCookieOptions());

  logUserLogin({
    office: account.office, // superadmin-er office nei, undefined jabe
    username: account.username,
    userId: account._id,
    ip: req.ip,
    hostname: req.hostname,
    userAgent: req.headers['user-agent'],
    requestUrl: req.originalUrl,
    status: 'success',
    authType,
    role: isSuperAdmin ? 'Super Admin' : 'Admin',
  });

  return new ApiResponse(
    200,
    { username: account.username, accessToken, type: authType },
    'Password reset successfully.'
  ).send(res);
});
