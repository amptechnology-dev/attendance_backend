import jwt from 'jsonwebtoken';
import expressAsyncHandler from 'express-async-handler';
import { Admin } from '../models/admin.model.js';
import { Staff } from '../models/staff.model.js';
import { ApiError } from '../utils/responseHandler.js';

/*
export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken || req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      throw new ApiError(401, 'Unauthorized Request');
    }

    const decodedData = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const user = await User.findById(decodedData?._id).select('-password -refreshToken');

    if (!user) {
      throw new ApiError(401, 'Invalid Token');
    }

    req.user = user;
    next();
  } catch (error) {
    throw new ApiError(401, error?.message || 'Invalid Token');
  }
});
*/

/*
export const publicApiAuth = asyncHandler(async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const office_id = req.headers['office-id'];

    if (!apiKey || apiKey !== process.env.PUBLIC_API_KEY) {
      throw new ApiError(401, 'Unauthorized Request. Invalid API Key');
    }

    const office = await Office.findById(office_id);

    if (!office || office?.is_active === false) {
      throw new ApiError(401, 'Unauthorized Request. Invalid Office Id or Office is inactive');
    }
    req.office = office;
    next();
  } catch (error) {
    throw new ApiError(401, error?.message || 'API Key not found!');
  }
});
*/

export const adminAuth = expressAsyncHandler(async (req, res, next) => {
  try {
    const token = req.signedCookies?.accessToken || req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized Request' });
    }

    const decodedData = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    if (!decodedData || decodedData.type !== 'admin') {
      return res.status(401).json({ message: 'Invalid Token' });
    }

    let admin = null;
    if (decodedData.model === 'admin') {
      admin = await Admin.findOne({ _id: decodedData?._id }).lean();
      if (admin) {
        admin.role = {
          name: 'SuperAdmin',
          permissions: ['*'],
          adminAccess: true,
        };
      }
    } else {
      admin = await Staff.findOne({ _id: decodedData?._id, status: 'active' })
        .select('+role office staffId fullName department')
        .populate('role')
        .lean();

      if (!admin?.role?.adminAccess) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    }

    if (!admin) {
      return res.status(401).json({ message: 'Invalid Token' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    return res.status(401).json({ message: error?.message || 'Invalid Token' });
  }
});

export const staffAuth = expressAsyncHandler(async (req, res, next) => {
  try {
    const token = req.signedCookies?.accessToken || req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized Request: No token provided' });
    }

    const decodedData = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    if (!decodedData) {
      return res.status(401).json({ message: 'Unauthorized Request: Invalid token' });
    }

    if (decodedData.type !== 'staff') {
      return res.status(403).json({ message: 'Forbidden: You do not have the required role' });
    }

    // Attach the user data from the token to the request
    req.staff = decodedData;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }

    return res.status(401).json({ message: error?.message || 'Unauthorized Request' });
  }
});

export const hasPermission = (requiredPermission) => {
  return (req, res, next) => {
    const user = req.admin;

    if (!user?.role?.permissions)
      return res.status(403).json({ message: 'Permission denied: No role or permissions found.' });

    if (user.role.permissions.includes('*') || user.role.permissions.includes(requiredPermission)) {
      return next();
    }

    return new ApiError(403, 'Forbidden', [{ message: 'You do not have the required permission.' }]).send(res);
  };
};

export const verifyPushAgent = (req, res, next) => {
  const apiKey = req.header('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return res.status(401).json({ message: 'Unauthorized Request' });
  }
  if (apiKey !== process.env.LOG_PUSH_API_KEY) {
    return res.status(401).json({ message: 'Unauthorized Request' });
  }
  next();
};
