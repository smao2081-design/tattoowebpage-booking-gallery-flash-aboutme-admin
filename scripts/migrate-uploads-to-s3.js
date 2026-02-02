#!/usr/bin/env node
/*
  Simple migration script to upload contents of `public/uploads` to an S3 bucket.
  Usage:
    S3_BUCKET=my-bucket S3_REGION=us-east-1 node scripts/migrate-uploads-to-s3.js

  Notes:
  - Requires AWS credentials in environment (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) or an EC2/EB role.
  - Sets object key equal to path under `public/uploads` (preserves subdirs).
  - If `--dry-run` is passed, it will only list files that would be uploaded.
*/
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
const BUCKET = process.env.S3_BUCKET || process.env.BUCKET || '';
const REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const DRY = process.argv.includes('--dry-run');

if (!BUCKET) {
  console.error('S3_BUCKET environment variable is required.');
  process.exit(1);
}

if (!fs.existsSync(uploadsDir)) {
  console.error('No uploads directory found at', uploadsDir);
  process.exit(1);
}

const s3 = new S3Client({ region: REGION });

async function walk(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await walk(full);
      files.push(...sub);
    } else if (e.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function uploadFile(filePath) {
  const rel = path.relative(uploadsDir, filePath).split(path.sep).join('/');
  const key = rel; // preserve relative path under uploads/
  console.log((DRY ? '[DRY]' : '[UP ]') + ' ', rel);
  if (DRY) return { key, path: filePath };
  const stream = fs.createReadStream(filePath);
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: stream }));
    return { key, path: filePath };
  } catch (e) {
    console.error('Failed to upload', rel, e);
    return null;
  }
}

async function main() {
  console.log('Scanning uploads in', uploadsDir);
  const files = await walk(uploadsDir);
  console.log(`Found ${files.length} files.`);
  let uploaded = 0;
  for (const f of files) {
    const res = await uploadFile(f);
    if (res) uploaded++;
  }
  console.log(`Done. Uploaded ${uploaded}/${files.length} files.${DRY ? ' (dry-run)' : ''}`);
}

main().catch((e) => { console.error('Migration failed', e); process.exit(2); });
