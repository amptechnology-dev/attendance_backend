import { S3Client } from '@aws-sdk/client-s3';

const r2 = new S3Client({
  region: 'auto',
  endpoint: 'https://1d07911481ec066c5483425b73452a53.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: '716321cf79735ad1a9f21ebdad2a602e',
    secretAccessKey: '2174394223c364fd04c40849af624ce7023038a9e2421c5f69c82518e3480230',
  },
});

export default r2;
