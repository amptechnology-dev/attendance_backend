import 'dotenv/config';
import mongoose from 'mongoose';
import { SuperAdmin } from '../src/models/superAdmin.model.js';

const { MONGO_URI, SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD } = process.env;

const run = async () => {
  if (!MONGO_URI || !SUPER_ADMIN_USERNAME || !SUPER_ADMIN_PASSWORD) {
    throw new Error('MONGO_URI, SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD .env a thaka lagbe');
  }

  await mongoose.connect(MONGO_URI);

  const exists = await SuperAdmin.findOne({ username: SUPER_ADMIN_USERNAME });
  if (exists) {
    console.log('Super admin already exists.');
  } else {
    await SuperAdmin.create({
      username: SUPER_ADMIN_USERNAME,
      password: SUPER_ADMIN_PASSWORD, // pre-save hook hash kore dibe
    });
    console.log('Super admin created.');
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});