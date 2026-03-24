import mongoose from 'mongoose';

const loginLogSchema = new mongoose.Schema(
  {
    office: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      index: true,
    },
    username: String,
    userId: mongoose.Schema.Types.ObjectId,
    ip: String,
    hostname: String,
    userAgent: String,
    requestUrl: String,
    status: { type: String, enum: ['success', 'fail'] },
    authType: String,
    role: String, // for success
    localTime: String,
  },
  { timestamps: true }
);

// TTL Index for auto-delete after 1 months
loginLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const LoginLog = mongoose.model('LoginLog', loginLogSchema);
