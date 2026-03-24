import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import r2 from '../config/r2.js';

export async function deleteFileFromR2(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key?.split('https://cdn.amptechnology.in/')[1],
    });
    await r2.send(command);
    return true;
  } catch (error) {
    console.log(error);
  }
}
