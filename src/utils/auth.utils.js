import jwt from 'jsonwebtoken';

export const generateAccessToken = (user, type, model = 'staff', expiresIn = process.env.ACCESS_TOKEN_EXPIRY) => {
  const payload = {
    _id: user._id,
    office: user.office,
    type,
    model,
  };
  return jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn });
};

export const generateRefreshToken = (user, type, model = 'staff', expiresIn = process.env.REFRESH_TOKEN_EXPIRY) => {
  const payload = {
    _id: user._id,
    type,
    model,
  };
  return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn });
};
