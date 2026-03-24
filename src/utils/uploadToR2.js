import { PutObjectCommand } from '@aws-sdk/client-s3';
import r2 from '../config/r2.js';

export async function uploadFileToR2(fileBuffer, key, fileType) {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: fileType,
  });
  await r2.send(command);
  return `https://cdn.amptechnology.in/${key}`;
}
