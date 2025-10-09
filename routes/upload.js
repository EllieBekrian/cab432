const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;
const DDB_TABLE = process.env.DDB_TABLE;
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '1024', 10);

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

router.post('/presign', async (req, res) => {
  try {
    const { filename, contentType, size } = req.body || {};
    if (!filename || !contentType || typeof size !== 'number') {
      return res.status(400).json({ error: 'filename, contentType, size are required' });
    }

    if (size > MAX_UPLOAD_MB * 1024 * 1024) {
      return res.status(413).json({ error: `File too large. Max ${MAX_UPLOAD_MB} MB` });
    }

    const ext = mime.extension(contentType) || 'bin';
    const id = uuidv4();
    const fileKey = `uploads/${id}-${Date.now()}.${ext}`;

    const putCmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, putCmd, { expiresIn: 900 });

    const putItem = new PutItemCommand({
      TableName: DDB_TABLE,
      Item: {
        id: { S: id },
        fileKey: { S: fileKey },
        filename: { S: filename },
        contentType: { S: contentType },
        size: { N: String(size) },
        status: { S: 'pending' },
        createdAt: { N: String(Date.now()) },
      },
    });
    await ddb.send(putItem);

    res.json({ uploadUrl, fileKey, id });
  } catch (err) {
    console.error('presign error:', err);
    res.status(500).json({ error: 'Failed to generate presigned URL' });
  }
});

router.get('/download', async (req, res) => {
  try {
    const { fileKey } = req.query;
    if (!fileKey) return res.status(400).json({ error: 'fileKey required' });

    const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: fileKey });
    const url = await getSignedUrl(s3, getCmd, { expiresIn: 900 });

    res.json({ downloadUrl: url });
  } catch (err) {
    console.error('download presign error:', err);
    res.status(500).json({ error: 'Failed to sign download URL' });
  }
});

module.exports = router;

